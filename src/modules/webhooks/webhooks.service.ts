import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  async handleNewClient(data: any) {
    this.logger.log(`New client webhook received: ${JSON.stringify(data)}`);

    // TODO: Implement new client handling from Make
    // This could create a notification for admins, etc.

    return {
      success: true,
      message: 'New client webhook processed',
    };
  }

  async handleOcrResult(data: any) {
    this.logger.log(`OCR result webhook received: ${JSON.stringify(data)}`);

    // TODO: Implement OCR result handling
    // This could update document metadata with extracted data

    return {
      success: true,
      message: 'OCR result webhook processed',
    };
  }
}
