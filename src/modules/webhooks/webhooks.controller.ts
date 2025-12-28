import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {}

  private validateApiKey(apiKey: string) {
    const validApiKey = this.configService.get<string>('MAKE_API_KEY');
    if (!apiKey || apiKey !== validApiKey) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  @Get('status')
  async status() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('make/new-client')
  async newClient(
    @Headers('x-api-key') apiKey: string,
    @Body() data: any,
  ) {
    this.validateApiKey(apiKey);
    return this.webhooksService.handleNewClient(data);
  }

  @Post('make/ocr-result')
  async ocrResult(
    @Headers('x-api-key') apiKey: string,
    @Body() data: any,
  ) {
    this.validateApiKey(apiKey);
    return this.webhooksService.handleOcrResult(data);
  }
}
