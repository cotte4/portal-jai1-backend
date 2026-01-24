import { ApiProperty } from '@nestjs/swagger';

export class EstimateResponseDto {
  @ApiProperty({ description: 'Federal tax withheld from W2 Box 2', example: 2500 })
  box2Federal: number;

  @ApiProperty({ description: 'State tax withheld from W2 Box 17', example: 800 })
  box17State: number;

  @ApiProperty({ description: 'Estimated total refund amount', example: 3300 })
  estimatedRefund: number;

  @ApiProperty({ description: 'OCR confidence level', enum: ['high', 'medium', 'low'], example: 'high' })
  ocrConfidence: 'high' | 'medium' | 'low';

  @ApiProperty({ description: 'Original W2 file name', example: 'w2_2024.pdf' })
  w2FileName: string;

  @ApiProperty({ description: 'Unique ID for this estimate' })
  estimateId: string;
}
