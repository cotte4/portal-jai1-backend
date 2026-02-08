import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import {
  ConsentFormStatusDto,
  ConsentFormPrefilledDto,
  SignConsentFormDto,
} from './dto';
import {
  CONSENT_FORM_TITLE,
  CONSENT_FORM_INTRO,
  CONSENT_FORM_CLAUSES,
  CONSENT_FORM_CLOSING,
  formatSpanishDate,
  CONSENT_FORM_FOOTER,
} from './templates/consent-form.template';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ConsentFormService {
  private readonly logger = new Logger(ConsentFormService.name);
  private readonly BUCKET_NAME = 'documents';

  // JAI-1 signature images loaded from assets
  private jai1Signatures: Map<string, Buffer> = new Map();
  private logoBuffer: Buffer | null = null;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private storagePath: StoragePathService,
    @Inject(forwardRef(() => ProgressAutomationService))
    private progressAutomation: ProgressAutomationService,
  ) {
    // Load JAI-1 signatures on startup
    this.loadJai1Signatures();
  }

  /**
   * Load JAI-1 signature images from assets folder
   */
  private loadJai1Signatures(): void {
    const signers = ['francisco-uria', 'lautaro-iglesias', 'tomas-bucci'];
    for (const signer of signers) {
      try {
        const filePath = path.join(__dirname, 'assets', 'signatures', `${signer}.png`);
        this.jai1Signatures.set(signer, fs.readFileSync(filePath));
      } catch (error) {
        this.logger.warn(`Could not load signature for ${signer}`);
      }
    }
    this.logger.log(`Loaded ${this.jai1Signatures.size}/3 JAI-1 signatures for PDF generation`);

    // Load JAI-1 logo
    try {
      const logoPath = path.join(__dirname, 'assets', 'jai1-logo.png');
      this.logoBuffer = fs.readFileSync(logoPath);
      this.logger.log('Loaded JAI-1 logo for PDF generation');
    } catch (error) {
      this.logger.warn('Could not load JAI-1 logo for PDF generation');
    }
  }

  /**
   * Get the consent form status for a user
   */
  async getStatus(userId: string): Promise<ConsentFormStatusDto> {
    const taxCase = await this.getTaxCase(userId);

    if (!taxCase) {
      return {
        status: 'pending',
        signedAt: null,
        canDownload: false,
      };
    }

    return {
      status: taxCase.consentFormStatus as 'pending' | 'signed',
      signedAt: taxCase.consentFormSignedAt,
      canDownload: !!taxCase.consentFormStoragePath,
    };
  }

  /**
   * Get pre-filled data for the consent form
   */
  async getPrefilled(userId: string): Promise<ConsentFormPrefilledDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        clientProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.clientProfile;
    const missingFields: string[] = [];

    // Check required fields
    if (!profile?.addressStreet) missingFields.push('address');
    if (!profile?.addressCity) missingFields.push('city');

    // Mask SSN if present (show last 4 digits)
    let dniPassport: string | null = null;
    if (profile?.ssn) {
      const ssn = profile.ssn;
      if (ssn.length >= 4) {
        dniPassport = `***-**-${ssn.slice(-4)}`;
      }
    }

    const dateInfo = formatSpanishDate(new Date());

    return {
      fullName: `${user.firstName} ${user.lastName}`,
      dniPassport,
      street: profile?.addressStreet || null,
      city: profile?.addressCity || null,
      email: user.email,
      date: dateInfo,
      canSign: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Sign the consent form and generate PDF
   */
  async sign(userId: string, signDto: SignConsentFormDto): Promise<{ success: boolean; downloadUrl: string }> {
    // Get user and profile data
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        clientProfile: {
          include: {
            taxCases: {
              orderBy: { taxYear: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.clientProfile;
    if (!profile) {
      throw new BadRequestException('Profile not found. Please complete your profile first.');
    }

    // Get or create tax case
    let taxCase = profile.taxCases[0];
    if (!taxCase) {
      taxCase = await this.prisma.taxCase.create({
        data: {
          clientProfileId: profile.id,
          taxYear: new Date().getFullYear(),
        },
      });
    }

    // Check if already signed
    if (taxCase.consentFormStatus === 'signed') {
      throw new BadRequestException('Consent form has already been signed.');
    }

    // Extract base64 image data
    const base64Data = signDto.signature.replace(/^data:image\/png;base64,/, '');
    const signatureBuffer = Buffer.from(base64Data, 'base64');

    // Generate PDF using form data provided by client
    const clientData = {
      fullName: signDto.fullName,
      dniPassport: signDto.dniPassport,
      street: signDto.street,
      city: signDto.city,
      email: signDto.email,
    };

    const pdfBuffer = await this.generateSignedPdf(clientData, signatureBuffer);

    // Generate storage path
    const storagePath = this.storagePath.generateDocumentPath({
      userId,
      taxYear: taxCase.taxYear,
      documentType: 'consent_form',
      originalFileName: `consent-form-signed-${Date.now()}.pdf`,
    });

    // Upload to Supabase
    await this.supabase.uploadFile(
      this.BUCKET_NAME,
      storagePath,
      pdfBuffer,
      'application/pdf',
    );

    // Update tax case
    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: {
        consentFormStatus: 'signed',
        consentFormSignedAt: new Date(),
        consentFormStoragePath: storagePath,
      },
    });

    // Also create a document record for the consent form
    await this.prisma.document.create({
      data: {
        taxCaseId: taxCase.id,
        type: 'consent_form',
        fileName: 'Acuerdo de Consentimiento - Firmado.pdf',
        storagePath,
        mimeType: 'application/pdf',
        fileSize: pdfBuffer.length,
        uploadedById: userId,
        isReviewed: false,
      },
    });

    // Get download URL
    const downloadUrl = await this.supabase.getSignedUrl(
      this.BUCKET_NAME,
      storagePath,
      3600, // 1 hour
    );

    this.logger.log(`Consent form signed by user ${userId}`);

    // Check if all 4 documentation items are now complete for auto-transition
    await this.progressAutomation.checkDocumentationCompleteAndTransition(taxCase.id, userId);

    return {
      success: true,
      downloadUrl,
    };
  }

  /**
   * Get download URL for signed consent form
   */
  async getDownloadUrl(userId: string): Promise<{ url: string }> {
    const taxCase = await this.getTaxCase(userId);

    if (!taxCase || !taxCase.consentFormStoragePath) {
      throw new NotFoundException('Signed consent form not found');
    }

    const url = await this.supabase.getSignedUrl(
      this.BUCKET_NAME,
      taxCase.consentFormStoragePath,
      3600, // 1 hour
    );

    return { url };
  }

  /**
   * Helper to get the user's tax case
   */
  private async getTaxCase(userId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      include: {
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
        },
      },
    });

    return profile?.taxCases[0] || null;
  }

  /**
   * Generate the signed PDF document (matches new frontend design)
   */
  private async generateSignedPdf(
    clientData: {
      fullName: string;
      dniPassport: string;
      street: string;
      city: string;
      email: string;
    },
    clientSignature: Buffer,
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    // Embed fonts
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page settings
    const pageWidth = 595; // A4
    const pageHeight = 842;
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;
    const lineHeight = 14;
    const fontSize = 10;
    const svgScale = pageWidth / 900; // 595/900 ≈ 0.661
    const footerHeight = Math.ceil(120 * svgScale); // ~80pt
    const footerReserve = margin + footerHeight + 10;

    // Colors matching frontend design
    const darkBlue = rgb(29 / 255, 52 / 255, 93 / 255); // #1D345D
    const burgundy = rgb(178 / 255, 27 / 255, 67 / 255); // #B21B43
    const textColor = rgb(51 / 255, 65 / 255, 85 / 255); // #334155
    const lightGray = rgb(226 / 255, 232 / 255, 240 / 255); // #e2e8f0
    const white = rgb(1, 1, 1);

    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight;

    // Helper: draw footer band on a page (curved shape matching frontend)
    const footerSvgPath =
      'M0,120 H900 V40 C900,40 700,40 600,40 C520,40 490,0 450,0 C410,0 380,40 300,40 C200,40 0,40 0,40 Z';
    const drawFooter = (page: typeof currentPage) => {
      page.drawSvgPath(footerSvgPath, {
        x: 0,
        y: footerHeight,
        scale: svgScale,
        color: burgundy,
      });
      // Contact info in white, centered in the lower solid portion
      const footerText = `${CONSENT_FORM_FOOTER.website}    |    ${CONSENT_FORM_FOOTER.phone}    |    ${CONSENT_FORM_FOOTER.email}`;
      const footerTextWidth = helvetica.widthOfTextAtSize(footerText, 8);
      page.drawText(footerText, {
        x: (pageWidth - footerTextWidth) / 2,
        y: 14,
        size: 8,
        font: helvetica,
        color: white,
      });
    };

    // Helper: check if we need a new page (reserves space for footer)
    const ensureSpace = (needed: number) => {
      if (yPosition - needed < footerReserve) {
        drawFooter(currentPage);
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin;
      }
    };

    // Helper: add text with word wrap
    const addWrappedText = (
      text: string,
      font: typeof helvetica,
      size: number,
      color: typeof textColor,
      maxWidth: number,
      xOffset = margin,
    ) => {
      const words = text.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, size);

        if (testWidth > maxWidth && currentLine) {
          ensureSpace(lineHeight);
          currentPage.drawText(currentLine, {
            x: xOffset,
            y: yPosition,
            size,
            font,
            color,
          });
          yPosition -= lineHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        ensureSpace(lineHeight);
        currentPage.drawText(currentLine, {
          x: xOffset,
          y: yPosition,
          size,
          font,
          color,
        });
        yPosition -= lineHeight;
      }
    };

    // ============ HEADER: Curved navy band (matches frontend SVG) ============
    const headerSvgPath =
      'M0,0 H900 V80 C900,80 700,80 600,80 C520,80 490,120 450,120 C410,120 380,80 300,80 C200,80 0,80 0,80 Z';
    const headerBandHeight = Math.ceil(120 * svgScale); // ~80pt

    currentPage.drawSvgPath(headerSvgPath, {
      x: 0,
      y: pageHeight,
      scale: svgScale,
      color: darkBlue,
    });

    // Embedded logo image below the curved header
    let logoBottomY = pageHeight - headerBandHeight;
    if (this.logoBuffer) {
      try {
        const logoImage = await pdfDoc.embedPng(this.logoBuffer);
        const logoHeight = 40;
        const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
        const logoX = (pageWidth - logoWidth) / 2;
        const logoY = pageHeight - headerBandHeight - 8 - logoHeight;
        currentPage.drawImage(logoImage, {
          x: logoX,
          y: logoY,
          width: logoWidth,
          height: logoHeight,
        });
        logoBottomY = logoY;
      } catch {
        this.logger.warn('Could not embed logo in PDF, skipping');
      }
    }

    yPosition = logoBottomY - 20;

    // ============ TITLE ============
    const titleFontSize = 16;
    const titleWidth = helveticaBold.widthOfTextAtSize(CONSENT_FORM_TITLE, titleFontSize);
    currentPage.drawText(CONSENT_FORM_TITLE, {
      x: (pageWidth - titleWidth) / 2,
      y: yPosition,
      size: titleFontSize,
      font: helveticaBold,
      color: darkBlue,
    });
    yPosition -= 12;

    // Thin burgundy accent line under title
    currentPage.drawLine({
      start: { x: pageWidth / 2 - 80, y: yPosition },
      end: { x: pageWidth / 2 + 80, y: yPosition },
      thickness: 2,
      color: burgundy,
    });
    yPosition -= 25;

    // ============ INTRODUCTION ============
    const introText = `${CONSENT_FORM_INTRO} ${clientData.fullName}, DNI/Pasaporte ${clientData.dniPassport}, con domicilio en calle ${clientData.street} de la ciudad de ${clientData.city} y electronico en la casilla de correo ${clientData.email}, en adelante el cliente, se celebra el presente acuerdo sujeto a las siguientes clausulas y condiciones:`;

    addWrappedText(introText, helvetica, fontSize, textColor, contentWidth);
    yPosition -= lineHeight;

    // ============ CLAUSES ============
    for (const clause of CONSENT_FORM_CLAUSES) {
      yPosition -= 4;
      addWrappedText(clause, helvetica, fontSize, textColor, contentWidth);
    }

    // ============ CLOSING ============
    yPosition -= 16;
    // Separator line
    ensureSpace(40);
    currentPage.drawLine({
      start: { x: margin, y: yPosition + 8 },
      end: { x: pageWidth - margin, y: yPosition + 8 },
      thickness: 0.5,
      color: lightGray,
    });

    addWrappedText(CONSENT_FORM_CLOSING, helvetica, fontSize, textColor, contentWidth);

    // Date
    const dateInfo = formatSpanishDate(new Date());
    yPosition -= 4;
    ensureSpace(lineHeight);
    currentPage.drawText(`a los ${dateInfo.day} del mes de ${dateInfo.month} de ${dateInfo.year}.-`, {
      x: margin,
      y: yPosition,
      size: fontSize,
      font: helvetica,
      color: darkBlue,
    });
    yPosition -= 35;

    // ============ SIGNATURES ============
    // Separator
    ensureSpace(280);
    currentPage.drawLine({
      start: { x: margin, y: yPosition + 8 },
      end: { x: pageWidth - margin, y: yPosition + 8 },
      thickness: 1.5,
      color: lightGray,
    });

    // Client signature
    ensureSpace(90);
    currentPage.drawText('FIRMA CLIENTE:', {
      x: margin,
      y: yPosition,
      size: 11,
      font: helveticaBold,
      color: darkBlue,
    });
    yPosition -= 5;

    try {
      const signatureImage = await pdfDoc.embedPng(clientSignature);
      const sigWidth = 160;
      const sigHeight = (signatureImage.height / signatureImage.width) * sigWidth;
      currentPage.drawImage(signatureImage, {
        x: margin,
        y: yPosition - sigHeight,
        width: sigWidth,
        height: sigHeight,
      });
      yPosition -= sigHeight + 5;
    } catch {
      currentPage.drawText('________________', {
        x: margin,
        y: yPosition - 15,
        size: fontSize,
        font: helvetica,
        color: textColor,
      });
      yPosition -= 25;
    }

    // Signer name under client signature
    currentPage.drawText(clientData.fullName, {
      x: margin,
      y: yPosition,
      size: 8,
      font: helvetica,
      color: rgb(148 / 255, 163 / 255, 184 / 255), // #94a3b8
    });
    yPosition -= 30;

    // JAI-1 signatures
    const jai1Signers = [
      { name: 'Francisco Uria', file: 'francisco-uria' },
      { name: 'Lautaro Iglesias', file: 'lautaro-iglesias' },
      { name: 'Tomas Bucci', file: 'tomas-bucci' },
    ];

    for (const signer of jai1Signers) {
      ensureSpace(75);
      currentPage.drawText('FIRMA JAI-1:', {
        x: margin,
        y: yPosition,
        size: 11,
        font: helveticaBold,
        color: darkBlue,
      });
      yPosition -= 5;

      // Try to embed actual signature image
      const sigBuffer = this.jai1Signatures.get(signer.file);
      if (sigBuffer) {
        try {
          const sigImage = await pdfDoc.embedPng(sigBuffer);
          const sigWidth = 120;
          const sigHeight = (sigImage.height / sigImage.width) * sigWidth;
          currentPage.drawImage(sigImage, {
            x: margin,
            y: yPosition - sigHeight,
            width: sigWidth,
            height: sigHeight,
          });
          yPosition -= sigHeight + 5;
        } catch {
          // Fallback to line
          currentPage.drawText('________________', {
            x: margin,
            y: yPosition - 15,
            size: fontSize,
            font: helvetica,
            color: textColor,
          });
          yPosition -= 25;
        }
      } else {
        currentPage.drawText('________________', {
          x: margin,
          y: yPosition - 15,
          size: fontSize,
          font: helvetica,
          color: textColor,
        });
        yPosition -= 25;
      }

      // Signer name
      currentPage.drawText(signer.name, {
        x: margin,
        y: yPosition,
        size: 8,
        font: helvetica,
        color: rgb(148 / 255, 163 / 255, 184 / 255),
      });
      yPosition -= 25;
    }

    // ============ FOOTER on every page ============
    const pages = pdfDoc.getPages();
    for (const page of pages) {
      drawFooter(page);
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
