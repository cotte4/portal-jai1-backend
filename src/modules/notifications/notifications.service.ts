import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { NotificationType } from '@prisma/client';
import { I18nService, SupportedLanguage } from '../../i18n';

/**
 * Simple LRU cache entry with TTL
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple LRU cache implementation
 */
class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // Add new entry
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * LRU cache for user language preferences
   * Max 10,000 entries (covers all users), 1 hour TTL
   */
  private readonly languageCache = new LRUCache<string, SupportedLanguage>(
    10000,
    60 * 60 * 1000, // 1 hour
  );

  // Gateway reference - injected lazily to avoid circular dependency
  private gateway: any;

  constructor(
    private prisma: PrismaService,
    private i18n: I18nService,
  ) {}

  /**
   * Set the gateway reference (called by NotificationsGateway)
   * This avoids circular dependency issues
   */
  setGateway(gateway: any): void {
    this.gateway = gateway;
  }

  /**
   * Create a notification with raw title and message (legacy method)
   */
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
      },
    });

    // Emit notification via WebSocket if gateway is available
    if (this.gateway) {
      this.gateway.emitNotificationToUser(userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        isArchived: notification.isArchived,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  }

  /**
   * Batch create notifications for multiple users (avoids N+1 queries)
   * @param userIds - Array of user IDs to notify
   * @param type - Notification type
   * @param title - Notification title
   * @param message - Notification message
   * @returns Number of notifications created
   */
  async createMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<{ count: number }> {
    if (userIds.length === 0) {
      return { count: 0 };
    }

    const result = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        message,
      })),
    });

    // Emit notifications via WebSocket if gateway is available
    // Note: createMany doesn't return created records, so we create minimal notification objects
    if (this.gateway && result.count > 0) {
      const notificationData = {
        type,
        title,
        message,
        isRead: false,
        isArchived: false,
        createdAt: new Date(),
      };
      this.gateway.emitNotificationToUsers(userIds, notificationData);
    }

    return { count: result.count };
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
      // Check cache first
      const cachedLang = this.languageCache.get(userId);
      if (cachedLang) {
        lang = cachedLang;
      } else {
        // Cache miss - query database
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { preferredLanguage: true },
        });
        lang = (user?.preferredLanguage as SupportedLanguage) || 'es';

        // Store in cache
        this.languageCache.set(userId, lang);
      }
    }

    // Validate language
    if (!this.i18n.isSupported(lang)) {
      lang = this.i18n.getDefaultLanguage();
    }

    const { title, message } = this.i18n.getNotification(templateKey, variables, lang);

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
      },
    });

    // Emit notification via WebSocket if gateway is available
    if (this.gateway) {
      this.gateway.emitNotificationToUser(userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        isArchived: notification.isArchived,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  }

  /**
   * Get all notifications for a user with cursor-based pagination
   * @param userId - User ID
   * @param unreadOnly - Filter to only unread notifications
   * @param includeArchived - Include archived notifications
   * @param cursor - Cursor for pagination (notification ID)
   * @param limit - Maximum number of results (default 20, max 100)
   * @returns Paginated notifications with cursor information
   */
  async findAll(
    userId: string,
    unreadOnly: boolean,
    includeArchived = false,
    cursor?: string,
    limit = 20,
  ) {
    // Enforce max limit
    const effectiveLimit = Math.min(limit, 100);

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

    // Fetch limit + 1 to determine if there are more results
    const notifications = await this.prisma.notification.findMany({
      where,
      take: effectiveLimit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = notifications.length > effectiveLimit;
    const results = hasMore ? notifications.slice(0, -1) : notifications;

    return {
      notifications: results.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        isArchived: notification.isArchived,
        createdAt: notification.createdAt,
      })),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
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
      where: { userId, isRead: false, deletedAt: null },
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
      where: { userId, isRead: true, isArchived: false, deletedAt: null },
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

  // ============= CACHE MANAGEMENT =============

  /**
   * Invalidate cached language preference for a user
   * Call this when a user updates their language preference
   * @param userId - User ID to invalidate cache for
   */
  invalidateLanguageCache(userId: string): void {
    this.languageCache.delete(userId);
    this.logger.log(`Language cache invalidated for user ${userId}`);
  }

  /**
   * Clear entire language cache (for testing or manual cache reset)
   */
  clearLanguageCache(): void {
    this.languageCache.clear();
    this.logger.log('Language cache cleared completely');
  }

  /**
   * Get cache statistics (for monitoring/debugging)
   */
  getLanguageCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.languageCache.size,
      maxSize: 10000,
    };
  }
}
