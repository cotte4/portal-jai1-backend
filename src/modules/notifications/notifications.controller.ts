import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Post,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { PAGINATION_LIMITS, validateLimit } from '../../common/constants';
import {
  NotificationsPaginatedResponseDto,
  UnreadCountResponseDto,
  NotificationActionResponseDto,
} from './dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (paginated)' })
  @ApiQuery({ name: 'unreadOnly', required: false, description: 'Filter to only unread' })
  @ApiQuery({ name: 'includeArchived', required: false, description: 'Include archived notifications' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'List of notifications', type: NotificationsPaginatedResponseDto })
  async findAll(
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.NOTIFICATIONS);
    return this.notificationsService.findAll(
      user.id,
      unreadOnly === 'true',
      includeArchived === 'true',
      cursor,
      validatedLimit,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread count', type: UnreadCountResponseDto })
  async getUnreadCount(@CurrentUser() user: any) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'Marked as read', type: NotificationActionResponseDto })
  async markAllAsRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch('archive-all-read')
  @ApiOperation({ summary: 'Archive all read notifications' })
  @ApiResponse({ status: 200, description: 'Archived', type: NotificationActionResponseDto })
  async archiveAllRead(@CurrentUser() user: any) {
    return this.notificationsService.archiveAllRead(user.id);
  }

  @Delete('read')
  @ApiOperation({ summary: 'Delete all read notifications' })
  @ApiResponse({ status: 200, description: 'Deleted', type: NotificationActionResponseDto })
  async deleteAllRead(@CurrentUser() user: any) {
    return this.notificationsService.deleteAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive notification' })
  @ApiResponse({ status: 200, description: 'Archived' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async archive(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.archive(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete notification' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.delete(id, user.id);
  }

  // ============= DEBUG/TESTING ENDPOINTS =============

  /**
   * Get WebSocket connection statistics (for debugging)
   */
  @Get('websocket/stats')
  async getWebSocketStats() {
    return this.notificationsGateway.getConnectionStats();
  }

  /**
   * Test endpoint: Send a test notification to yourself
   * Useful for testing WebSocket delivery
   */
  @Post('test')
  async sendTestNotification(
    @CurrentUser() user: any,
    @Body('title') title?: string,
    @Body('message') message?: string,
  ) {
    const notification = await this.notificationsService.create(
      user.id,
      'system',
      title || 'Test Notification',
      message || 'This is a test notification sent via WebSocket',
    );

    return {
      message: 'Test notification sent',
      notification,
      isUserConnected: this.notificationsGateway.isUserConnected(user.id),
    };
  }
}
