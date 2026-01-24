import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  CLOSED = 'closed',
}

export class UpdateStatusDto {
  @ApiProperty({ description: 'New ticket status', enum: TicketStatus, example: 'in_progress' })
  @IsEnum(TicketStatus)
  status: TicketStatus;
}
