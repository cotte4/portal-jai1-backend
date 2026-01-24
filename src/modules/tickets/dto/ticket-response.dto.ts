import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * User information included in ticket responses.
 */
export class TicketUserDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'User email' })
  email: string;

  @ApiPropertyOptional({ description: 'User first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name' })
  lastName?: string;

  @ApiPropertyOptional({ description: 'User role', enum: ['admin', 'client'] })
  role?: 'admin' | 'client';
}

/**
 * Message sender information.
 */
export class MessageSenderDto {
  @ApiProperty({ description: 'Sender ID' })
  id: string;

  @ApiPropertyOptional({ description: 'Sender first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Sender last name' })
  lastName?: string;

  @ApiProperty({ description: 'Sender role', enum: ['admin', 'client'] })
  role: 'admin' | 'client';
}

/**
 * Ticket message DTO.
 */
export class TicketMessageDto {
  @ApiProperty({ description: 'Message ID' })
  id: string;

  @ApiProperty({ description: 'Message content' })
  message: string;

  @ApiProperty({ description: 'Sender ID' })
  senderId: string;

  @ApiProperty({ description: 'Whether message has been read' })
  isRead: boolean;

  @ApiProperty({ description: 'Message creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Sender information', type: MessageSenderDto })
  sender: MessageSenderDto;
}

/**
 * Ticket list item DTO (for findAll endpoint).
 */
export class TicketListItemDto {
  @ApiProperty({ description: 'Ticket ID' })
  id: string;

  @ApiProperty({ description: 'Ticket subject' })
  subject: string;

  @ApiProperty({ description: 'Ticket status', enum: ['open', 'in_progress', 'closed'] })
  status: 'open' | 'in_progress' | 'closed';

  @ApiProperty({ description: 'Owner user ID' })
  userId: string;

  @ApiProperty({ description: 'Number of unread messages' })
  unreadCount: number;

  @ApiProperty({ description: 'Total message count' })
  messageCount: number;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ description: 'User information', type: TicketUserDto })
  user: TicketUserDto;
}

/**
 * Full ticket detail DTO (for findOne endpoint).
 */
export class TicketDetailDto {
  @ApiProperty({ description: 'Ticket ID' })
  id: string;

  @ApiProperty({ description: 'Ticket subject' })
  subject: string;

  @ApiProperty({ description: 'Ticket status', enum: ['open', 'in_progress', 'closed'] })
  status: 'open' | 'in_progress' | 'closed';

  @ApiProperty({ description: 'Owner user ID' })
  userId: string;

  @ApiProperty({ description: 'Number of unread messages' })
  unreadCount: number;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ description: 'User information', type: TicketUserDto })
  user: TicketUserDto;

  @ApiProperty({ description: 'Ticket messages', type: [TicketMessageDto] })
  messages: TicketMessageDto[];
}

/**
 * Paginated tickets response.
 */
export class TicketsPaginatedResponseDto {
  @ApiProperty({ description: 'List of tickets', type: [TicketListItemDto] })
  tickets: TicketListItemDto[];

  @ApiPropertyOptional({ description: 'Cursor for next page', nullable: true })
  nextCursor: string | null;

  @ApiProperty({ description: 'Whether more results exist' })
  hasMore: boolean;
}

/**
 * Response for creating a ticket.
 */
export class CreateTicketResponseDto {
  @ApiProperty({ description: 'Created ticket ID' })
  id: string;

  @ApiProperty({ description: 'Ticket subject' })
  subject: string;

  @ApiProperty({ description: 'Ticket status' })
  status: string;

  @ApiProperty({ description: 'Success message' })
  message: string;
}

/**
 * Response for updating ticket status.
 */
export class UpdateTicketStatusResponseDto {
  @ApiProperty({ description: 'Ticket ID' })
  id: string;

  @ApiProperty({ description: 'Updated status' })
  status: string;

  @ApiProperty({ description: 'Success message' })
  message: string;
}
