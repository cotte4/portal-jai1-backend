import { IsEnum } from 'class-validator';

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  CLOSED = 'closed',
}

export class UpdateStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;
}
