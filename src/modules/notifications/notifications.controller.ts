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
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.notificationsService.findAll(
      user.id,
      unreadOnly === 'true',
      includeArchived === 'true',
      cursor,
      parsedLimit,
    );
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  // IMPORTANT: Static routes must come before dynamic routes
  // 'read-all', 'archive-all-read', 'delete-all-read' must be defined before ':id/*'
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch('archive-all-read')
  async archiveAllRead(@CurrentUser() user: any) {
    return this.notificationsService.archiveAllRead(user.id);
  }

  @Delete('read')
  async deleteAllRead(@CurrentUser() user: any) {
    return this.notificationsService.deleteAllRead(user.id);
  }

  @Patch(':id/read')
  async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch(':id/archive')
  async archive(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.archive(id, user.id);
  }

  @Delete(':id')
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
      'GENERAL',
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
