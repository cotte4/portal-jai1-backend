import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

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

  async findAll(userId: string, unreadOnly: boolean, includeArchived = false) {
    const where: any = {
      userId,
      deletedAt: null, // Exclude soft-deleted notifications
    };

    if (unreadOnly) {
      where.isRead = false;
    }

    // Exclude archived notifications by default
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
}
