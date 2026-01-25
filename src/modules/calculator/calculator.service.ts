import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { redactUserId, redactFileName, redactStoragePath } from '../../common/utils/log-sanitizer';
import OpenAI from 'openai';
import { pdf } from 'pdf-to-img';

interface OcrResult {
  box_2: string;
  box_17: string;
}

// Retry configuration
const OCR_MAX_RETRIES = 3;
const OCR_RETRY_DELAY_MS = 1000;

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);
  private readonly BUCKET_NAME = 'documents';
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private storagePath: StoragePathService,
    private configService: ConfigService,
    @Inject(forwardRef(() => ProgressAutomationService))
    private progressAutomation: ProgressAutomationService,
  ) {}

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new InternalServerErrorException('OpenAI API key not configured');
      }
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  async estimateRefund(userId: string, file: Express.Multer.File) {
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPG, PNG images and PDF files are allowed for W2 scanning.',
      );
    }

    this.logger.log(`Processing W2 OCR for user ${redactUserId(userId)}: ${redactFileName(file.originalname)} (${file.size} bytes)`);

    // Convert file buffer to base64 (handle PDF conversion if needed)
    let base64Image: string;
    let mimeType: string;

    if (file.mimetype === 'application/pdf') {
      // Convert first page of PDF to PNG image
      this.logger.log('Converting PDF to image for OCR processing...');
      const { imageBuffer, imageMimeType } = await this.convertPdfToImage(file.buffer);
      base64Image = imageBuffer.toString('base64');
      mimeType = imageMimeType;
      this.logger.log('PDF converted to image successfully');
    } else {
      base64Image = file.buffer.toString('base64');
      mimeType = file.mimetype;
    }

    // Call OpenAI Vision API with retry logic
    const { ocrResult, rawResponse } = await this.callOpenAIWithRetry(base64Image, mimeType);

    // Parse values
    const box2Federal = parseFloat(ocrResult.box_2) || 0;
    const box17State = parseFloat(ocrResult.box_17) || 0;
    const estimatedRefund = box2Federal + box17State;

    // Determine confidence level
    let ocrConfidence: 'high' | 'medium' | 'low';
    if (box2Federal > 0 && box17State > 0) {
      ocrConfidence = 'high';
    } else if (box2Federal > 0 || box17State > 0) {
      ocrConfidence = 'medium';
    } else {
      ocrConfidence = 'low';
    }

    // Upload file to Supabase Storage using centralized path service
    // Use w2 folder (same as documents upload) for consistency across all W2 uploads
    let w2StoragePath: string | null = null;
    const taxYear = new Date().getFullYear();
    try {
      w2StoragePath = this.storagePath.generateDocumentPath({
        userId,
        taxYear,
        documentType: 'w2',
        originalFileName: file.originalname,
      });

      await this.supabase.uploadFile(
        this.BUCKET_NAME,
        w2StoragePath,
        file.buffer,
        file.mimetype,
      );
      this.logger.log(`W2 estimate image stored at: ${redactStoragePath(w2StoragePath)}`);
    } catch (uploadError) {
      this.logger.error('Failed to upload W2 to storage (non-fatal):', uploadError);
      // Continue without storage - estimate can still be saved
    }

    // Save estimate to database
    // Store only safe OCR metadata (not the full response which may contain sensitive data)
    const safeOcrMetadata = {
      model: rawResponse?.model,
      created: rawResponse?.created,
      usage: rawResponse?.usage, // token counts only
      finish_reason: rawResponse?.choices?.[0]?.finish_reason,
      // Explicitly NOT storing: choices[].message.content (contains extracted tax values)
    };

    const estimate = await this.prisma.w2Estimate.create({
      data: {
        userId,
        box2Federal,
        box17State,
        estimatedRefund,
        w2FileName: file.originalname,
        w2StoragePath,
        ocrConfidence,
        ocrRawResponse: safeOcrMetadata,
      },
    });

    this.logger.log(`W2 estimate created: ${estimate.id} (confidence: ${ocrConfidence})`);

    // Sync estimated refund to TaxCase and create Document record
    // This eliminates the need for a second upload from the frontend
    const taxCase = await this.syncEstimateToTaxCase(userId, estimatedRefund);

    // Create Document record if we have a valid storage path and tax case
    // This makes the W2 visible in "Mis Documentos" without a second upload
    if (w2StoragePath && taxCase) {
      try {
        await this.prisma.document.create({
          data: {
            taxCaseId: taxCase.id,
            type: 'w2',
            fileName: file.originalname,
            storagePath: w2StoragePath,
            mimeType: file.mimetype,
            fileSize: file.size,
            taxYear,
          },
        });
        this.logger.log(`Document record created for W2: ${file.originalname}`);

        // Update computed status fields (isReadyToPresent, isIncomplete)
        await this.updateClientComputedStatus(taxCase.clientProfileId);

        // Emit W2_UPLOADED event for progress automation
        try {
          const clientName = await this.progressAutomation.getClientName(userId);
          await this.progressAutomation.processEvent({
            type: 'W2_UPLOADED',
            userId,
            taxCaseId: taxCase.id,
            metadata: { clientName, fileName: file.originalname },
          });
          this.logger.log(`Emitted W2_UPLOADED event for user ${redactUserId(userId)}`);
        } catch (eventError) {
          this.logger.error('Failed to emit W2_UPLOADED event (non-fatal):', eventError);
        }
      } catch (docError) {
        this.logger.error('Failed to create Document record (non-fatal):', docError);
        // Continue - the estimate is still valid, just won't show in "Mis Documentos"
      }
    }

    return {
      box2Federal,
      box17State,
      estimatedRefund,
      ocrConfidence,
      w2FileName: file.originalname,
      estimateId: estimate.id,
    };
  }

  /**
   * Call OpenAI Vision API with retry logic
   * Retries up to OCR_MAX_RETRIES times with exponential backoff
   */
  private async callOpenAIWithRetry(
    base64Image: string,
    mimeType: string,
  ): Promise<{ ocrResult: OcrResult; rawResponse: any }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= OCR_MAX_RETRIES; attempt++) {
      try {
        this.logger.log(`OpenAI OCR attempt ${attempt}/${OCR_MAX_RETRIES}`);

        const response = await this.getOpenAI().chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Your task is to correctly extract the numerical values from [box 2] and [box 17] from this W2 document.
[box 2] corresponds to: Federal income Tax withheld
[box 17] corresponds to: State income Tax
In most cases you will find both values inside of their respective boxes.
If you do not find a value on those boxes, make a second try in searching the correct value. If you didnt find one of the values, use the value as a last resource: [0.00]
Format the response as JSON.
FORMAT: Only output the response in JSON
EXAMPLE OF A GOOD OUTPUT:
{
  "box_2": "1110.02",
  "box_17": "410.11"
}`,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 500,
        });

        const content = response.choices[0]?.message?.content;

        if (!content) {
          throw new Error('No response content from OpenAI');
        }

        const ocrResult = JSON.parse(content) as OcrResult;
        this.logger.log(`OpenAI OCR successful on attempt ${attempt}`);

        return { ocrResult, rawResponse: response };
      } catch (error: any) {
        lastError = error;
        this.logger.warn(
          `OpenAI OCR attempt ${attempt} failed: ${error?.message || 'Unknown error'}`,
        );

        // Don't retry on certain errors (bad request, auth issues)
        if (error?.status === 400 || error?.status === 401 || error?.status === 403) {
          this.logger.error('Non-retryable OpenAI error, aborting retries');
          break;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < OCR_MAX_RETRIES) {
          const delay = OCR_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.log(`Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.logger.error(`OpenAI OCR failed after ${OCR_MAX_RETRIES} attempts`);
    throw new InternalServerErrorException(
      lastError?.message || 'Failed to process W2 document after multiple attempts. Please try again.',
    );
  }

  /**
   * Helper function to sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert PDF buffer to PNG image (first page only)
   * Uses pdf-to-img library which is based on pdfjs-dist
   */
  private async convertPdfToImage(pdfBuffer: Buffer): Promise<{ imageBuffer: Buffer; imageMimeType: string }> {
    try {
      // pdf-to-img returns an async iterator of page images
      const pdfDocument = await pdf(pdfBuffer, { scale: 2.0 }); // Higher scale for better OCR

      // Get only the first page
      for await (const image of pdfDocument) {
        // The image is a Buffer containing PNG data
        return {
          imageBuffer: image,
          imageMimeType: 'image/png',
        };
      }

      throw new Error('PDF has no pages');
    } catch (error: any) {
      this.logger.error(`PDF conversion failed: ${error?.message || 'Unknown error'}`);
      throw new BadRequestException(
        'Failed to process PDF file. Please ensure the PDF is not corrupted or password-protected.',
      );
    }
  }

  async getEstimateHistory(userId: string) {
    return this.prisma.w2Estimate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        box2Federal: true,
        box17State: true,
        estimatedRefund: true,
        w2FileName: true,
        ocrConfidence: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get the latest estimate for a user (prevents recalculation issues)
   * Frontend should call this first to check if estimate already exists
   */
  async getLatestEstimate(userId: string) {
    const estimate = await this.prisma.w2Estimate.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        box2Federal: true,
        box17State: true,
        estimatedRefund: true,
        w2FileName: true,
        ocrConfidence: true,
        createdAt: true,
      },
    });

    if (!estimate) {
      return { hasEstimate: false, estimate: null };
    }

    return {
      hasEstimate: true,
      estimate: {
        ...estimate,
        box2Federal: Number(estimate.box2Federal),
        box17State: Number(estimate.box17State),
        estimatedRefund: Number(estimate.estimatedRefund),
      },
    };
  }

  /**
   * Check if user already has an estimate (quick check without full data)
   */
  async hasExistingEstimate(userId: string): Promise<boolean> {
    const count = await this.prisma.w2Estimate.count({
      where: { userId },
    });
    return count > 0;
  }

  /**
   * Sync estimated refund from W2Estimate to TaxCase
   * This ensures both Dashboard (Inicio) and Seguimiento show the same value
   * Dashboard reads from W2Estimate, Seguimiento reads from TaxCase
   * Returns the TaxCase for use in Document creation
   */
  private async syncEstimateToTaxCase(userId: string, estimatedRefund: number): Promise<{ id: string; clientProfileId: string } | null> {
    try {
      // Get user's client profile, auto-create if doesn't exist
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { clientProfile: true },
      });

      let clientProfile = user?.clientProfile;

      // Auto-create client profile if it doesn't exist (for users who go straight to calculator)
      if (!clientProfile && user) {
        this.logger.log(`Auto-creating client profile for user ${userId} during W2 estimate`);
        clientProfile = await this.prisma.clientProfile.create({
          data: {
            userId,
            isDraft: true,
            profileComplete: false,
          },
        });
      }

      if (!clientProfile) {
        this.logger.warn(`User ${userId} not found, skipping TaxCase sync`);
        return null;
      }

      // Get or create TaxCase for current year
      const currentYear = new Date().getFullYear();
      let taxCase = await this.prisma.taxCase.findFirst({
        where: {
          clientProfileId: clientProfile.id,
          taxYear: currentYear,
        },
      });

      if (!taxCase) {
        // Create TaxCase if it doesn't exist
        taxCase = await this.prisma.taxCase.create({
          data: {
            clientProfileId: clientProfile.id,
            taxYear: currentYear,
            estimatedRefund,
          },
        });
        this.logger.log(`Created TaxCase ${taxCase.id} with estimated refund $${estimatedRefund}`);
      } else {
        // Update existing TaxCase with new estimated refund
        taxCase = await this.prisma.taxCase.update({
          where: { id: taxCase.id },
          data: { estimatedRefund },
        });
        this.logger.log(`Updated TaxCase ${taxCase.id} with estimated refund $${estimatedRefund}`);
      }

      return { id: taxCase.id, clientProfileId: clientProfile.id };
    } catch (error) {
      // Non-fatal error - estimate is still saved in W2Estimate table
      this.logger.error(`Failed to sync estimate to TaxCase for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Update computed status fields for a client profile.
   * Called after W2 upload to update isReadyToPresent and isIncomplete flags.
   */
  private async updateClientComputedStatus(clientProfileId: string): Promise<void> {
    try {
      const clientProfile = await this.prisma.clientProfile.findUnique({
        where: { id: clientProfileId },
        include: {
          taxCases: {
            orderBy: { taxYear: 'desc' },
            take: 1,
            include: {
              documents: {
                where: { type: 'w2' },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!clientProfile) return;

      const taxCase = clientProfile.taxCases[0];
      const hasW2 = taxCase?.documents && taxCase.documents.length > 0;

      const isReadyToPresent =
        clientProfile.profileComplete &&
        !clientProfile.isDraft &&
        hasW2;

      const isIncomplete = !isReadyToPresent;

      if (
        clientProfile.isReadyToPresent !== isReadyToPresent ||
        clientProfile.isIncomplete !== isIncomplete
      ) {
        await this.prisma.clientProfile.update({
          where: { id: clientProfileId },
          data: { isReadyToPresent, isIncomplete },
        });
        this.logger.log(`Updated computed status for client ${clientProfileId}: ready=${isReadyToPresent}`);
      }
    } catch (error) {
      this.logger.error('Failed to update computed status:', error);
    }
  }
}
