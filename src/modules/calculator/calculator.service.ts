import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

interface OcrResult {
  box_2: string;
  box_17: string;
}

@Injectable()
export class CalculatorService {
  private readonly BUCKET_NAME = 'documents';
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private configService: ConfigService,
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
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPG and PNG images are allowed for W2 scanning.',
      );
    }

    // Convert file buffer to base64
    const base64Image = file.buffer.toString('base64');
    const mimeType = file.mimetype;

    // Call OpenAI Vision API
    let ocrResult: OcrResult;
    let rawResponse: any;

    try {
      console.log('=== CALCULATOR: Calling OpenAI Vision API ===');
      console.log('File:', file.originalname, 'Size:', file.size, 'Type:', file.mimetype);

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

      rawResponse = response;
      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from OpenAI');
      }

      ocrResult = JSON.parse(content);
    } catch (error: any) {
      console.error('=== CALCULATOR ERROR ===');
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error status:', error?.status);
      console.error('Full error:', JSON.stringify(error, null, 2));
      throw new InternalServerErrorException(
        error?.message || 'Failed to process W2 document. Please try again.',
      );
    }

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

    // Upload file to Supabase Storage (optional - for record keeping)
    let storagePath: string | null = null;
    try {
      const fileExtension = file.originalname.split('.').pop();
      storagePath = `w2-estimates/${userId}/${Date.now()}-${uuidv4()}.${fileExtension}`;

      await this.supabase.uploadFile(
        this.BUCKET_NAME,
        storagePath,
        file.buffer,
        file.mimetype,
      );
    } catch (uploadError) {
      console.error('Failed to upload W2 to storage:', uploadError);
      // Continue without storage - estimate can still be saved
    }

    // Save estimate to database
    const estimate = await this.prisma.w2Estimate.create({
      data: {
        userId,
        box2Federal,
        box17State,
        estimatedRefund,
        w2FileName: file.originalname,
        w2StoragePath: storagePath,
        ocrConfidence,
        ocrRawResponse: rawResponse,
      },
    });

    return {
      box2Federal,
      box17State,
      estimatedRefund,
      ocrConfidence,
      w2FileName: file.originalname,
      estimateId: estimate.id,
    };
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
}
