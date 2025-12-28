import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: any,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 25 * 1024 * 1024 }), // 25MB
          new FileTypeValidator({ fileType: /(pdf|jpg|jpeg|png)$/i }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() uploadDto: UploadDocumentDto,
  ) {
    return this.documentsService.upload(user.id, file, uploadDto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query('client_id') clientId?: string,
  ) {
    // Admin can query any client, regular user can only see their own
    if (user.role === 'admin' && clientId) {
      return this.documentsService.findByClientId(clientId);
    }
    return this.documentsService.findByUserId(user.id);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: any, @Param('id') id: string) {
    return this.documentsService.getDownloadUrl(id, user.id, user.role);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.documentsService.remove(id, user.id, user.role);
  }
}
