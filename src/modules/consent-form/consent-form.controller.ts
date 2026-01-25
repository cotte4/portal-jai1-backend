import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConsentFormService } from './consent-form.service';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import {
  ConsentFormStatusDto,
  ConsentFormPrefilledDto,
  SignConsentFormDto,
} from './dto';

@ApiTags('Consent Form')
@Controller('consent-form')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ConsentFormController {
  private readonly logger = new Logger(ConsentFormController.name);

  constructor(private readonly consentFormService: ConsentFormService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get consent form status' })
  @ApiResponse({ status: 200, description: 'Returns consent form status', type: ConsentFormStatusDto })
  async getStatus(@CurrentUser() user: any): Promise<ConsentFormStatusDto> {
    return this.consentFormService.getStatus(user.id);
  }

  @Get('prefilled')
  @ApiOperation({ summary: 'Get pre-filled client data for consent form' })
  @ApiResponse({ status: 200, description: 'Returns pre-filled data', type: ConsentFormPrefilledDto })
  async getPrefilled(@CurrentUser() user: any): Promise<ConsentFormPrefilledDto> {
    return this.consentFormService.getPrefilled(user.id);
  }

  @Post('sign')
  @ApiOperation({ summary: 'Sign consent form with client signature' })
  @ApiResponse({ status: 201, description: 'Consent form signed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request or missing required data' })
  async sign(
    @CurrentUser() user: any,
    @Body() signDto: SignConsentFormDto,
  ): Promise<{ success: boolean; downloadUrl: string }> {
    this.logger.log(`User ${user.id} signing consent form`);
    return this.consentFormService.sign(user.id, signDto);
  }

  @Get('download')
  @ApiOperation({ summary: 'Get download URL for signed consent form' })
  @ApiResponse({ status: 200, description: 'Returns signed URL for PDF download' })
  @ApiResponse({ status: 404, description: 'Signed consent form not found' })
  async download(@CurrentUser() user: any): Promise<{ url: string }> {
    return this.consentFormService.getDownloadUrl(user.id);
  }
}
