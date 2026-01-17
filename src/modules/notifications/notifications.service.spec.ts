import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../config/prisma.service';
import { I18nService } from '../../i18n';

// Mock data
const mockNotification = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'message',
  title: 'Test Title',
  message: 'Test message content',
  isRead: false,
  isArchived: false,
  deletedAt: null,
  createdAt: new Date('2024-01-15'),
};

const mockReadNotification = {
  ...mockNotification,
  id: 'notif-2',
  isRead: true,
};

const mockArchivedNotification = {
  ...mockNotification,
  id: 'notif-3',
  isRead: true,
  isArchived: true,
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let i18n: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    i18n = {
      getNotification: jest.fn().mockReturnValue({
        title: 'Translated Title',
        message: 'Translated message',
      }),
      isSupported: jest.fn().mockReturnValue(true),
      getDefaultLanguage: jest.fn().mockReturnValue('es'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: I18nService, useValue: i18n },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a notification with provided data', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);

      const result = await service.create(
        'user-1',
        'message' as any,
        'Test Title',
        'Test message content',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'message',
          title: 'Test Title',
          message: 'Test message content',
        },
      });
      expect(result).toEqual(mockNotification);
    });

    it('should create notification with different types', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);

      await service.create('user-1', 'status_change' as any, 'Status', 'Changed');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'status_change' }),
      });
    });
  });

  describe('createFromTemplate', () => {
    it('should create notification using i18n template with user language', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
      prisma.notification.create.mockResolvedValue(mockNotification);

      await service.createFromTemplate(
        'user-1',
        'message' as any,
        'notifications.welcome',
        { name: 'John' },
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { preferredLanguage: true },
      });
      expect(i18n.getNotification).toHaveBeenCalledWith(
        'notifications.welcome',
        { name: 'John' },
        'en',
      );
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'message',
          title: 'Translated Title',
          message: 'Translated message',
        },
      });
    });

    it('should use default language if user has no preference', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
      prisma.notification.create.mockResolvedValue(mockNotification);

      await service.createFromTemplate('user-1', 'message' as any, 'test.key');

      expect(i18n.getNotification).toHaveBeenCalledWith('test.key', {}, 'es');
    });

    it('should use provided language override', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);

      await service.createFromTemplate(
        'user-1',
        'message' as any,
        'test.key',
        {},
        'en',
      );

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(i18n.getNotification).toHaveBeenCalledWith('test.key', {}, 'en');
    });

    it('should fall back to default language if unsupported', async () => {
      i18n.isSupported.mockReturnValue(false);
      prisma.notification.create.mockResolvedValue(mockNotification);

      await service.createFromTemplate(
        'user-1',
        'message' as any,
        'test.key',
        {},
        'invalid' as any,
      );

      expect(i18n.getDefaultLanguage).toHaveBeenCalled();
      expect(i18n.getNotification).toHaveBeenCalledWith('test.key', {}, 'es');
    });
  });

  describe('findAll', () => {
    it('should return all notifications for user', async () => {
      prisma.notification.findMany.mockResolvedValue([mockNotification, mockReadNotification]);

      const result = await service.findAll('user-1', false);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          isArchived: false,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'notif-1',
        type: 'message',
        title: 'Test Title',
        message: 'Test message content',
        isRead: false,
        isArchived: false,
        createdAt: expect.any(Date),
      });
    });

    it('should filter unread only when specified', async () => {
      prisma.notification.findMany.mockResolvedValue([mockNotification]);

      await service.findAll('user-1', true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          isArchived: false,
          isRead: false,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should include archived when specified', async () => {
      prisma.notification.findMany.mockResolvedValue([
        mockNotification,
        mockArchivedNotification,
      ]);

      await service.findAll('user-1', false, true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue(mockNotification);
      prisma.notification.update.mockResolvedValue({ ...mockNotification, isRead: true });

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { isRead: true },
      });
      expect(result).toEqual({ message: 'Notification marked as read' });
    });

    it('should throw NotFoundException if notification not found', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead('invalid-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own notification', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...mockNotification,
        userId: 'other-user',
      });

      await expect(service.markAsRead('notif-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
      expect(result).toEqual({ message: 'All notifications marked as read' });
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(7);

      const result = await service.getUnreadCount('user-1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: false,
          isArchived: false,
          deletedAt: null,
        },
      });
      expect(result).toEqual({ count: 7 });
    });

    it('should return 0 when no unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('user-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('archive', () => {
    it('should archive a notification', async () => {
      prisma.notification.findUnique.mockResolvedValue(mockNotification);
      prisma.notification.update.mockResolvedValue({ ...mockNotification, isArchived: true });

      const result = await service.archive('notif-1', 'user-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { isArchived: true },
      });
      expect(result).toEqual({ message: 'Notification archived' });
    });

    it('should throw NotFoundException if notification not found', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.archive('invalid-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own notification', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...mockNotification,
        userId: 'other-user',
      });

      await expect(service.archive('notif-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('archiveAllRead', () => {
    it('should archive all read notifications', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 10 });

      const result = await service.archiveAllRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: true, isArchived: false },
        data: { isArchived: true },
      });
      expect(result).toEqual({
        message: 'All read notifications archived',
        count: 10,
      });
    });
  });

  describe('delete', () => {
    it('should soft-delete a notification', async () => {
      prisma.notification.findUnique.mockResolvedValue(mockNotification);
      prisma.notification.update.mockResolvedValue({
        ...mockNotification,
        deletedAt: new Date(),
      });

      const result = await service.delete('notif-1', 'user-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ message: 'Notification deleted' });
    });

    it('should throw NotFoundException if notification not found', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.delete('invalid-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own notification', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...mockNotification,
        userId: 'other-user',
      });

      await expect(service.delete('notif-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteAllRead', () => {
    it('should soft-delete all read notifications', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 15 });

      const result = await service.deleteAllRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: true,
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({
        message: 'All read notifications deleted',
        count: 15,
      });
    });
  });

  describe('cleanupOldNotifications', () => {
    it('should hard delete old notifications with default 6 months', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 100 });

      const result = await service.cleanupOldNotifications();

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { deletedAt: { not: null, lt: expect.any(Date) } },
            { isArchived: true, createdAt: { lt: expect.any(Date) } },
            { createdAt: { lt: expect.any(Date) } },
          ],
        },
      });
      expect(result).toEqual({ deleted: 100 });
    });

    it('should use custom months parameter', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 50 });

      const result = await service.cleanupOldNotifications(3);

      expect(result).toEqual({ deleted: 50 });
    });

    it('should return 0 when no notifications to delete', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupOldNotifications();

      expect(result).toEqual({ deleted: 0 });
    });
  });

  describe('handleNotificationCleanupCron', () => {
    it('should call cleanupOldNotifications with 6 months', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 25 });

      await service.handleNotificationCleanupCron();

      expect(prisma.notification.deleteMany).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      prisma.notification.deleteMany.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(service.handleNotificationCleanupCron()).resolves.not.toThrow();
    });
  });
});
