import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IrsClientDto {
  @ApiProperty({ description: 'TaxCase ID' })
  taxCaseId: string;

  @ApiProperty({ description: 'Tax year' })
  taxYear: number;

  @ApiProperty({ description: 'Client full name' })
  clientName: string;

  @ApiProperty({ description: 'Client email' })
  clientEmail: string;

  @ApiPropertyOptional({ description: 'Masked SSN (***-**-XXXX)' })
  ssnMasked: string | null;

  @ApiPropertyOptional({ description: 'Current JAI1 federal status' })
  federalStatusNew: string | null;

  @ApiPropertyOptional({ description: 'When current status was last changed' })
  federalStatusNewChangedAt: Date | null;

  @ApiPropertyOptional({ description: 'Estimated federal refund amount' })
  estimatedRefund: any;

  @ApiPropertyOptional({ description: 'Most recent IRS check result' })
  lastCheck: any;
}

export class IrsRunCheckResponseDto {
  @ApiProperty({ description: 'Whether the scrape completed without error' })
  success: boolean;

  @ApiProperty({ description: 'Whether JAI1 federal status was updated' })
  statusChanged: boolean;

  @ApiPropertyOptional({ description: 'Previous JAI1 federal status' })
  previousStatus: string | null;

  @ApiPropertyOptional({ description: 'New JAI1 federal status (if changed)' })
  newStatus: string | null;

  @ApiProperty({ description: 'Raw text extracted from IRS WMR page' })
  rawStatus: string;

  @ApiPropertyOptional({ description: 'Error message if check failed' })
  error?: string;

  @ApiProperty({ description: 'Saved IrsCheck record' })
  check: any;
}
