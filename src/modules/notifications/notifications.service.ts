import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { NotificationType } from '@prisma/client';
import { I18nService, SupportedLanguage } from '../../i18n';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Create a notification with raw title and message (legacy method)
   */
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    return this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
      },
    });
  }

  /**
   * Create a notification using i18n template
   * @param userId - Target user ID
   * @param type - Notification type
   * @param templateKey - i18n key like "notifications.welcome"
   * @param variables - Variables to interpolate
   * @param language - Optional language override (uses user's preferred language if not specified)
   */
  async createFromTemplate(
    userId: string,
    type: NotificationType,
    templateKey: string,
    variables: Record<string, string | number> = {},
    language?: SupportedLanguage,
  ) {
    // Get user's preferred language if not specified
    let lang = language;
    if (!lang) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
      });
      lang = (user?.preferredLanguage as SupportedLanguage) || 'es';
    }

    // Validate language
    if (!this.i18n.isSupported(lang)) {
      lang = this.i18n.getDefaultLanguage();
    }

    const { title, message } = this.i18n.getNotification(templateKey, variables, lang);

    return this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
      },
    });
  }

  async findAll(userId: string, unreadOnly: boolean, includeArchived = false) {
    const where: any = {
      userId,
      deletedAt: null,
    };

    if (unreadOnly) {
      where.isRead = false;
    }

    if (!includeArchived) {
      where.isArchived = false;
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      isArchived: notification.isArchived,
      createdAt: notification.createdAt,
    }));
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return { message: 'Notification marked as read' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { message: 'All notifications marked as read' };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false, isArchived: false, deletedAt: null },
    });
    return { count };
  }

  async archive(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isArchived: true },
    });

    return { message: 'Notification archived' };
  }

  async archiveAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: true, isArchived: false },
      data: { isArchived: true },
    });

    return { message: 'All read notifications archived', count: result.count };
  }

  // ============= DELETION METHODS (Feature #3: Cleanup) =============

  /**
   * Soft-delete a single notification
   */
  async delete(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { deletedAt: new Date() },
    });

    return { message: 'Notification deleted' };
  }

  /**
   * Soft-delete all read notifications for a user
   */
  async deleteAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: true,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    return { message: 'All read notifications deleted', count: result.count };
  }

  /**
   * Hard delete notifications that have been soft-deleted for more than X months
   * This is called by cron but can also be triggered manually
   */
  async cleanupOldNotifications(monthsOld: number = 6): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);

    // Also cleanup old soft-deleted and archived notifications
    const result = await this.prisma.notification.deleteMany({
      where: {
        OR: [
          // Soft-deleted notifications older than X months
          {
            deletedAt: { not: null, lt: cutoffDate },
          },
          // Archived notifications older than X months
          {
            isArchived: true,
            createdAt: { lt: cutoffDate },
          },
          // All notifications older than 12 months regardless of status
          {
            createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
          },
        ],
      },
    });

    return { deleted: result.count };
  }

  // ============= CRON JOB: Auto-cleanup =============

  /**
   * Daily cron job to clean up old notifications
   * Runs at 3 AM (low traffic time)
   */
  @Cron('0 3 * * *', {
    name: 'cleanup-old-notifications',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async handleNotificationCleanupCron(): Promise<void> {
    this.logger.log('=== CRON: Starting notification cleanup ===');

    try {
      const result = await this.cleanupOldNotifications(6);
      this.logger.log(`=== CRON: Cleanup completed - ${result.deleted} notifications permanently deleted ===`);
    } catch (error) {
      this.logger.error('=== CRON: Notification cleanup failed ===', error);
    }
  }
}
