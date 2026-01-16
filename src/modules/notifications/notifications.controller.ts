import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.notificationsService.findAll(
      user.id,
      unreadOnly === 'true',
      includeArchived === 'true',
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
}
