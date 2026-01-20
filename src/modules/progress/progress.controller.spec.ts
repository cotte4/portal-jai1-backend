import { Test, TestingModule } from '@nestjs/testing';
import { ProgressController } from './progress.controller';
import { ProgressAutomationService } from './progress-automation.service';

/**
 * Progress Controller Unit Tests
 *
 * Tests the ProgressController's admin endpoints for managing
 * document progress automation and cron jobs.
 */

describe('ProgressController', () => {
  let controller: ProgressController;
  let progressService: jest.Mocked<ProgressAutomationService>;

  const mockUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin',
  };

  beforeEach(async () => {
    const mockProgressService = {
      checkAndNotifyMissingDocuments: jest.fn(),
      sendMissingDocsNotification: jest.fn(),
      getMissingDocsCronStatus: jest.fn(),
      setMissingDocsCronEnabled: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProgressController],
      providers: [
        { provide: ProgressAutomationService, useValue: mockProgressService },
      ],
    }).compile();

    controller = module.get<ProgressController>(ProgressController);
    progressService = module.get(ProgressAutomationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /admin/progress/check-missing-documents', () => {
    it('should check missing documents with default parameters', async () => {
      progressService.checkAndNotifyMissingDocuments.mockResolvedValue({
        notified: 5,
        skipped: 2,
      });

      const result = await controller.checkMissingDocuments();

      expect(progressService.checkAndNotifyMissingDocuments).toHaveBeenCalledWith(3, 3);
      expect(result.message).toBe('Missing documents check completed');
      expect(result.notified).toBe(5);
      expect(result.skipped).toBe(2);
    });

    it('should use custom daysThreshold parameter', async () => {
      progressService.checkAndNotifyMissingDocuments.mockResolvedValue({
        notified: 3,
        skipped: 1,
      });

      const result = await controller.checkMissingDocuments('5');

      expect(progressService.checkAndNotifyMissingDocuments).toHaveBeenCalledWith(5, 3);
      expect(result.notified).toBe(3);
    });

    it('should use custom maxNotifications parameter', async () => {
      progressService.checkAndNotifyMissingDocuments.mockResolvedValue({
        notified: 10,
        skipped: 0,
      });

      const result = await controller.checkMissingDocuments(undefined, '5');

      expect(progressService.checkAndNotifyMissingDocuments).toHaveBeenCalledWith(3, 5);
      expect(result.notified).toBe(10);
    });

    it('should use both custom parameters', async () => {
      progressService.checkAndNotifyMissingDocuments.mockResolvedValue({
        notified: 7,
        skipped: 3,
      });

      const result = await controller.checkMissingDocuments('7', '10');

      expect(progressService.checkAndNotifyMissingDocuments).toHaveBeenCalledWith(7, 10);
      expect(result.notified).toBe(7);
      expect(result.skipped).toBe(3);
    });

    it('should handle zero results', async () => {
      progressService.checkAndNotifyMissingDocuments.mockResolvedValue({
        notified: 0,
        skipped: 0,
      });

      const result = await controller.checkMissingDocuments();

      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('POST /admin/progress/send-missing-docs-notification', () => {
    it('should send notification successfully', async () => {
      progressService.sendMissingDocsNotification.mockResolvedValue(true);

      const result = await controller.sendMissingDocsNotification('user-456');

      expect(progressService.sendMissingDocsNotification).toHaveBeenCalledWith('user-456');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification sent successfully');
    });

    it('should return failure when notification not sent', async () => {
      progressService.sendMissingDocsNotification.mockResolvedValue(false);

      const result = await controller.sendMissingDocsNotification('user-789');

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'No notification sent (no missing documents or user not found)',
      );
    });

    it('should handle different user IDs', async () => {
      progressService.sendMissingDocsNotification.mockResolvedValue(true);

      await controller.sendMissingDocsNotification('specific-user-id-abc');

      expect(progressService.sendMissingDocsNotification).toHaveBeenCalledWith(
        'specific-user-id-abc',
      );
    });
  });

  describe('GET /admin/progress/cron/missing-docs/status', () => {
    it('should return enabled status', async () => {
      progressService.getMissingDocsCronStatus.mockResolvedValue({
        enabled: true,
        lastUpdated: new Date('2024-01-15T10:00:00Z'),
      });

      const result = await controller.getMissingDocsCronStatus();

      expect(progressService.getMissingDocsCronStatus).toHaveBeenCalled();
      expect(result.enabled).toBe(true);
      expect(result.lastUpdated).toBeDefined();
    });

    it('should return disabled status', async () => {
      progressService.getMissingDocsCronStatus.mockResolvedValue({
        enabled: false,
        lastUpdated: null,
      });

      const result = await controller.getMissingDocsCronStatus();

      expect(result.enabled).toBe(false);
      expect(result.lastUpdated).toBeNull();
    });
  });

  describe('PATCH /admin/progress/cron/missing-docs/status', () => {
    it('should enable cron job', async () => {
      progressService.setMissingDocsCronEnabled.mockResolvedValue({ enabled: true });

      const result = await controller.setMissingDocsCronStatus(true, mockUser);

      expect(progressService.setMissingDocsCronEnabled).toHaveBeenCalledWith(
        true,
        'admin-123',
      );
      expect(result.enabled).toBe(true);
    });

    it('should disable cron job', async () => {
      progressService.setMissingDocsCronEnabled.mockResolvedValue({ enabled: false });

      const result = await controller.setMissingDocsCronStatus(false, mockUser);

      expect(progressService.setMissingDocsCronEnabled).toHaveBeenCalledWith(
        false,
        'admin-123',
      );
      expect(result.enabled).toBe(false);
    });

    it('should pass admin user id to service', async () => {
      progressService.setMissingDocsCronEnabled.mockResolvedValue({ enabled: true });

      await controller.setMissingDocsCronStatus(true, { id: 'different-admin-456' });

      expect(progressService.setMissingDocsCronEnabled).toHaveBeenCalledWith(
        true,
        'different-admin-456',
      );
    });

    it('should handle undefined user gracefully', async () => {
      progressService.setMissingDocsCronEnabled.mockResolvedValue({ enabled: true });

      await controller.setMissingDocsCronStatus(true, undefined);

      expect(progressService.setMissingDocsCronEnabled).toHaveBeenCalledWith(
        true,
        undefined,
      );
    });
  });
});
