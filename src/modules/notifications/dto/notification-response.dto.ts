import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Notification type enum values.
 */
export type NotificationTypeEnum =
  | 'status_update'
  | 'document_update'
  | 'message'
  | 'refund_update'
  | 'referral'
  | 'system';

/**
 * Single notification DTO.
 */
export class NotificationDto {
  @ApiProperty({ description: 'Notification ID' })
  id: string;

  @ApiProperty({ description: 'User ID who received the notification' })
  userId: string;

  @ApiProperty({
    description: 'Notification type',
    enum: ['status_update', 'document_update', 'message', 'refund_update', 'referral', 'system']
  })
  type: NotificationTypeEnum;

  @ApiProperty({ description: 'Notification title' })
  title: string;

  @ApiProperty({ description: 'Notification message' })
  message: string;

  @ApiProperty({ description: 'Whether notification has been read' })
  isRead: boolean;

  @ApiProperty({ description: 'Whether notification is archived' })
  isArchived: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;
}

/**
 * Paginated notifications response.
 */
export class NotificationsPaginatedResponseDto {
  @ApiProperty({ description: 'List of notifications', type: [NotificationDto] })
  notifications: NotificationDto[];

  @ApiPropertyOptional({ description: 'Cursor for next page', nullable: true })
  nextCursor: string | null;

  @ApiProperty({ description: 'Whether more results exist' })
  hasMore: boolean;
}

/**
 * Unread count response.
 */
export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Number of unread notifications' })
  count: number;
}

/**
 * Generic success response for notification actions.
 */
export class NotificationActionResponseDto {
  @ApiProperty({ description: 'Success status' })
  success: boolean;

  @ApiPropertyOptional({ description: 'Number of affected notifications' })
  count?: number;
}

/**
 * WebSocket stats response.
 */
export class WebSocketStatsResponseDto {
  @ApiProperty({ description: 'Number of connected users' })
  connectedUsers: number;

  @ApiProperty({ description: 'Total number of connections' })
  totalConnections: number;
}
