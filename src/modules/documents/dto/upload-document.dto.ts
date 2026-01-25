import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export enum DocumentType {
  W2 = 'w2',
  PAYMENT_PROOF = 'payment_proof',
  CONSENT_FORM = 'consent_form',
  OTHER = 'other',
}

export class UploadDocumentDto {
  @ApiProperty({ description: 'Document type', enum: DocumentType, example: 'w2' })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiPropertyOptional({ description: 'Tax year for the document', example: 2024 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  tax_year?: number;
}
