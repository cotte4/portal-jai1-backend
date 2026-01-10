import {
  Controller,
  Get,
  Patch,
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

  // IMPORTANT: Static routes must come before dynamic routes
  // 'read-all' and 'archive-all-read' must be defined before ':id/*' to prevent being matched as an :id
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch('archive-all-read')
  async archiveAllRead(@CurrentUser() user: any) {
    return this.notificationsService.archiveAllRead(user.id);
  }

  @Patch(':id/read')
  async markAsRead(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch(':id/archive')
  async archive(@CurrentUser() user: any, @Param('id') id: string) {
    return this.notificationsService.archive(id, user.id);
  }
}
