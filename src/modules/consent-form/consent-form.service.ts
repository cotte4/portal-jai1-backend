import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
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

  // JAI-1 signature images (base64) - will be loaded from assets or stored directly
  private jai1Signatures: Buffer[] | null = null;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private storagePath: StoragePathService,
  ) {
    // Load JAI-1 signatures on startup
    this.loadJai1Signatures();
  }

  /**
   * Load JAI-1 signature images from assets folder
   */
  private async loadJai1Signatures(): Promise<void> {
    try {
      // Signatures will be embedded as base64 strings in production
      // For now, we'll generate placeholder signatures in the PDF
      this.logger.log('JAI-1 signatures ready for PDF generation');
    } catch (error) {
      this.logger.warn('Could not load JAI-1 signatures, will use text placeholders');
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
   * Generate the signed PDF document
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
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // Embed fonts
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page settings
    const pageWidth = 595; // A4 width in points
    const pageHeight = 842; // A4 height in points
    const margin = 50;
    const lineHeight = 14;
    const fontSize = 10;
    const titleFontSize = 16;

    // Colors
    const darkBlue = rgb(29 / 255, 52 / 255, 93 / 255); // #1D345D
    const textColor = rgb(0.2, 0.2, 0.2);

    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;

    // Helper function to add text with word wrap
    const addWrappedText = (
      text: string,
      font: typeof helvetica,
      size: number,
      color: typeof textColor,
      maxWidth: number,
    ) => {
      const words = text.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, size);

        if (testWidth > maxWidth && currentLine) {
          // Check if we need a new page
          if (yPosition < margin + 50) {
            currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
            yPosition = pageHeight - margin;
          }

          currentPage.drawText(currentLine, {
            x: margin,
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

      // Draw remaining text
      if (currentLine) {
        if (yPosition < margin + 50) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          yPosition = pageHeight - margin;
        }
        currentPage.drawText(currentLine, {
          x: margin,
          y: yPosition,
          size,
          font,
          color,
        });
        yPosition -= lineHeight;
      }
    };

    // Draw header/logo placeholder (could be replaced with actual logo)
    currentPage.drawRectangle({
      x: margin,
      y: yPosition - 30,
      width: pageWidth - 2 * margin,
      height: 40,
      color: darkBlue,
    });

    currentPage.drawText('JAI-1', {
      x: pageWidth / 2 - 20,
      y: yPosition - 20,
      size: 20,
      font: helveticaBold,
      color: rgb(1, 1, 1),
    });

    yPosition -= 60;

    // Title
    const titleWidth = helveticaBold.widthOfTextAtSize(CONSENT_FORM_TITLE, titleFontSize);
    currentPage.drawText(CONSENT_FORM_TITLE, {
      x: (pageWidth - titleWidth) / 2,
      y: yPosition,
      size: titleFontSize,
      font: helveticaBold,
      color: darkBlue,
    });
    yPosition -= 30;

    // Introduction with client data (from form input)
    const introText = `${CONSENT_FORM_INTRO} ${clientData.fullName}, DNI/Pasaporte ${clientData.dniPassport}, con domicilio en calle ${clientData.street} de la ciudad de ${clientData.city} y electronico en la casilla de correo ${clientData.email}, en adelante el cliente, se celebra el presente acuerdo sujeto a las siguientes clausulas y condiciones:`;

    addWrappedText(introText, helvetica, fontSize, textColor, pageWidth - 2 * margin);
    yPosition -= lineHeight;

    // Clauses
    for (const clause of CONSENT_FORM_CLAUSES) {
      yPosition -= 5; // Small gap between clauses
      addWrappedText(clause, helvetica, fontSize, textColor, pageWidth - 2 * margin);
    }

    // Closing text
    yPosition -= 20;
    addWrappedText(CONSENT_FORM_CLOSING, helvetica, fontSize, textColor, pageWidth - 2 * margin);

    // Date
    const dateInfo = formatSpanishDate(new Date());
    yPosition -= 10;
    currentPage.drawText(`a los ${dateInfo.day} del mes de ${dateInfo.month} de ${dateInfo.year}.-`, {
      x: margin,
      y: yPosition,
      size: fontSize,
      font: helvetica,
      color: textColor,
    });
    yPosition -= 40;

    // Signatures section - may need new page
    if (yPosition < 250) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      yPosition = pageHeight - margin;
    }

    // Client signature
    currentPage.drawText('FIRMA CLIENTE:', {
      x: margin,
      y: yPosition,
      size: fontSize,
      font: helveticaBold,
      color: darkBlue,
    });

    // Embed and draw client signature
    try {
      const signatureImage = await pdfDoc.embedPng(clientSignature);
      const signatureWidth = 150;
      const signatureHeight = (signatureImage.height / signatureImage.width) * signatureWidth;

      currentPage.drawImage(signatureImage, {
        x: margin + 100,
        y: yPosition - signatureHeight + 10,
        width: signatureWidth,
        height: signatureHeight,
      });
    } catch (error) {
      this.logger.warn('Could not embed client signature image, using placeholder');
      currentPage.drawText('________________', {
        x: margin + 100,
        y: yPosition,
        size: fontSize,
        font: helvetica,
        color: textColor,
      });
    }

    yPosition -= 80;

    // JAI-1 signatures (3 signatures)
    const jai1Signers = ['Francisco Uria', 'Lautaro Iglesias', 'Tomas Bucci'];

    for (const signer of jai1Signers) {
      currentPage.drawText('FIRMA JAI-1:', {
        x: margin,
        y: yPosition,
        size: fontSize,
        font: helveticaBold,
        color: darkBlue,
      });

      // Signature line with name
      currentPage.drawText('________________', {
        x: margin + 80,
        y: yPosition,
        size: fontSize,
        font: helvetica,
        color: textColor,
      });

      currentPage.drawText(signer, {
        x: margin + 200,
        y: yPosition,
        size: 8,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });

      yPosition -= 50;
    }

    // Footer
    yPosition = margin;

    // Footer line
    currentPage.drawLine({
      start: { x: margin, y: yPosition + 20 },
      end: { x: pageWidth - margin, y: yPosition + 20 },
      thickness: 1,
      color: darkBlue,
    });

    // Footer text
    const footerText = `${CONSENT_FORM_FOOTER.website}  |  ${CONSENT_FORM_FOOTER.phone}  |  ${CONSENT_FORM_FOOTER.email}`;
    const footerWidth = helvetica.widthOfTextAtSize(footerText, 8);
    currentPage.drawText(footerText, {
      x: (pageWidth - footerWidth) / 2,
      y: yPosition,
      size: 8,
      font: helvetica,
      color: darkBlue,
    });

    // Serialize to buffer
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
