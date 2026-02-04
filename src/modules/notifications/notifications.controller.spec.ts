import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

/**
 * Notifications Controller Unit Tests
 *
 * Tests the NotificationsController's routing and request handling for:
 * - Fetching notifications
 * - Marking as read
 * - Archiving notifications
 * - Deleting notifications
 */

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: jest.Mocked<NotificationsService>;

  // Mock user
  const mockUser = {
    id: 'user-123',
    email: 'user@example.com',
    role: 'client',
  };

  // Mock notification data
  const mockNotification = {
    id: 'notif-123',
    userId: 'user-123',
    title: 'Document Received',
    message: 'Your W2 has been received and is being processed.',
    type: 'info',
    isRead: false,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNotificationsList = [mockNotification];

  beforeEach(async () => {
    const mockNotificationsService = {
      findAll: jest.fn(),
      getUnreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
      archive: jest.fn(),
      archiveAllRead: jest.fn(),
      delete: jest.fn(),
      deleteAllRead: jest.fn(),
    };

    const mockNotificationsGateway = {
      sendToUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: NotificationsGateway, useValue: mockNotificationsGateway },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /notifications', () => {
    it('should return all notifications for user', async () => {
      notificationsService.findAll.mockResolvedValue(mockNotificationsList);

      const result = await controller.findAll(mockUser, undefined, undefined);

      expect(notificationsService.findAll).toHaveBeenCalledWith(mockUser.id, false, false, undefined, 20);
      expect(result).toEqual(mockNotificationsList);
    });

    it('should return only unread notifications when unreadOnly is true', async () => {
      notificationsService.findAll.mockResolvedValue(mockNotificationsList);

      const result = await controller.findAll(mockUser, 'true', undefined);

      expect(notificationsService.findAll).toHaveBeenCalledWith(mockUser.id, true, false, undefined, 20);
      expect(result).toEqual(mockNotificationsList);
    });

    it('should include archived when includeArchived is true', async () => {
      notificationsService.findAll.mockResolvedValue(mockNotificationsList);

      const result = await controller.findAll(mockUser, undefined, 'true');

      expect(notificationsService.findAll).toHaveBeenCalledWith(mockUser.id, false, true, undefined, 20);
      expect(result).toEqual(mockNotificationsList);
    });

    it('should combine filters correctly', async () => {
      notificationsService.findAll.mockResolvedValue([]);

      await controller.findAll(mockUser, 'true', 'true');

      expect(notificationsService.findAll).toHaveBeenCalledWith(mockUser.id, true, true, undefined, 20);
    });

    it('should return empty array when no notifications', async () => {
      notificationsService.findAll.mockResolvedValue([]);

      const result = await controller.findAll(mockUser, undefined, undefined);

      expect(result).toEqual([]);
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('should return unread notification count', async () => {
      const countResponse = { count: 5 };
      notificationsService.getUnreadCount.mockResolvedValue(countResponse);

      const result = await controller.getUnreadCount(mockUser);

      expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(countResponse);
    });

    it('should return zero when no unread notifications', async () => {
      const countResponse = { count: 0 };
      notificationsService.getUnreadCount.mockResolvedValue(countResponse);

      const result = await controller.getUnreadCount(mockUser);

      expect(result.count).toBe(0);
    });
  });

  describe('PATCH /notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      const response = { updatedCount: 5 };
      notificationsService.markAllAsRead.mockResolvedValue(response);

      const result = await controller.markAllAsRead(mockUser);

      expect(notificationsService.markAllAsRead).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(response);
    });
  });

  describe('PATCH /notifications/archive-all-read', () => {
    it('should archive all read notifications', async () => {
      const response = { archivedCount: 3 };
      notificationsService.archiveAllRead.mockResolvedValue(response);

      const result = await controller.archiveAllRead(mockUser);

      expect(notificationsService.archiveAllRead).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(response);
    });
  });

  describe('DELETE /notifications/read', () => {
    it('should delete all read notifications', async () => {
      const response = { deletedCount: 3 };
      notificationsService.deleteAllRead.mockResolvedValue(response);

      const result = await controller.deleteAllRead(mockUser);

      expect(notificationsService.deleteAllRead).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(response);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('should mark single notification as read', async () => {
      const readNotification = { ...mockNotification, isRead: true };
      notificationsService.markAsRead.mockResolvedValue(readNotification);

      const result = await controller.markAsRead(mockUser, 'notif-123');

      expect(notificationsService.markAsRead).toHaveBeenCalledWith('notif-123', mockUser.id);
      expect(result.isRead).toBe(true);
    });
  });

  describe('PATCH /notifications/:id/archive', () => {
    it('should archive single notification', async () => {
      const archivedNotification = { ...mockNotification, isArchived: true };
      notificationsService.archive.mockResolvedValue(archivedNotification);

      const result = await controller.archive(mockUser, 'notif-123');

      expect(notificationsService.archive).toHaveBeenCalledWith('notif-123', mockUser.id);
      expect(result.isArchived).toBe(true);
    });
  });

  describe('DELETE /notifications/:id', () => {
    it('should delete single notification', async () => {
      const response = { message: 'Notification deleted successfully' };
      notificationsService.delete.mockResolvedValue(response);

      const result = await controller.delete(mockUser, 'notif-123');

      expect(notificationsService.delete).toHaveBeenCalledWith('notif-123', mockUser.id);
      expect(result).toEqual(response);
    });
  });
});
