import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CalculatorService } from './calculator.service';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@Controller('calculator')
@UseGuards(JwtAuthGuard)
export class CalculatorController {
  constructor(private readonly calculatorService: CalculatorService) {}

  @Post('estimate')
  @UseInterceptors(
    FileInterceptor('w2File', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/^(image\/(jpeg|jpg|png)|application\/pdf)$/)) {
          return callback(new Error('Only JPG, PNG images and PDF files are allowed'), false);
        }
        callback(null, true);
      },
    }),
  )
  async estimate(
    @CurrentUser() user: any,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 25 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.calculatorService.estimateRefund(user.id, file);
  }

  @Get('history')
  async getHistory(@CurrentUser() user: any) {
    return this.calculatorService.getEstimateHistory(user.id);
  }

  /**
   * Get the latest estimate for the current user
   * Frontend should call this to check if estimate already exists
   * before triggering a new calculation
   */
  @Get('latest')
  async getLatestEstimate(@CurrentUser() user: any) {
    return this.calculatorService.getLatestEstimate(user.id);
  }

  /**
   * Quick check if user has any existing estimate
   */
  @Get('has-estimate')
  async hasEstimate(@CurrentUser() user: any) {
    const hasEstimate = await this.calculatorService.hasExistingEstimate(user.id);
    return { hasEstimate };
  }
}
