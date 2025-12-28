import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export enum DocumentType {
  W2 = 'w2',
  PAYMENT_PROOF = 'payment_proof',
  OTHER = 'other',
}

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Transform(({ value }) => parseInt(value, 10))
  tax_year?: number;
}
