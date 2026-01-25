import { ApiProperty } from '@nestjs/swagger';

export class ConsentFormStatusDto {
  @ApiProperty({ description: 'Consent form status', enum: ['pending', 'signed'] })
  status: 'pending' | 'signed';

  @ApiProperty({ description: 'When the consent form was signed', nullable: true })
  signedAt: Date | null;

  @ApiProperty({ description: 'Whether the signed PDF can be downloaded' })
  canDownload: boolean;
}
