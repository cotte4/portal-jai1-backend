import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateTicketDto {
  @ApiProperty({ description: 'Ticket subject/title', example: 'Question about my tax refund status' })
  @IsString()
  @MinLength(5, { message: 'Subject must be at least 5 characters' })
  @MaxLength(200, { message: 'Subject must not exceed 200 characters' })
  subject: string;

  @ApiPropertyOptional({ description: 'Initial message for the ticket', example: 'I would like to know when I can expect my refund.' })
  @IsString()
  @IsOptional()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(2000, { message: 'Message must not exceed 2000 characters' })
  message?: string;
}
