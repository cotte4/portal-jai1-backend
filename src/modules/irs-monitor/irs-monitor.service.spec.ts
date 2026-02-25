import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IrsCheckTrigger, IrsCheckResult, PaymentMethod, FederalStatusNew } from '@prisma/client';
import { IrsMonitorService } from './irs-monitor.service';
import { IrsScraperService } from './irs-scraper.service';
import { IrsStatusMapperService } from './irs-status-mapper.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../../config/supabase.service';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const CASE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ADMIN_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const mockTaxCase = {
  id: CASE_ID,
  taxYear: 2024,
  federalStatusNew: FederalStatusNew.taxes_en_proceso,
  federalActualRefund: 1215,
  estimatedRefund: null,
  paymentMethod: PaymentMethod.direct_deposit,
  filingStatus: 'single',
  clientProfile: {
    ssn: 'encrypted-ssn',
    user: { firstName: 'Maria', lastName: 'Test', email: 'maria@test.com' },
  },
};

const mockScrapeSuccess = {
  rawStatus: 'Return Received',
  details: 'Return Received — Your return is being processed.',
  screenshotPath: 'checks/abc/123.png',
  result: IrsCheckResult.success as const,
};

const mockScrapeError = {
  rawStatus: 'Error',
  details: '',
  screenshotPath: null,
  result: IrsCheckResult.error as const,
  errorMessage: 'Timeout waiting for selector',
};

const mockScrapeTimeout = {
  rawStatus: 'Error',
  details: '',
  screenshotPath: null,
  result: IrsCheckResult.timeout as const,
  errorMessage: 'Timed out 30000ms',
};

// ─── Mock factories ───────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  taxCase: {
    findUnique: jest.fn().mockResolvedValue(mockTaxCase),
    findMany: jest.fn().mockResolvedValue([{ id: CASE_ID }]),
    update: jest.fn().mockResolvedValue({}),
  },
  irsCheck: {
    create: jest.fn().mockResolvedValue({ id: 'check-id-1', ...mockScrapeSuccess }),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue({ id: 'check-id-1', screenshotPath: 'checks/abc/123.png' }),
    count: jest.fn().mockResolvedValue(3),
  },
  taxCaseStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn().mockImplementation((fn) => fn({
    taxCase: { update: jest.fn().mockResolvedValue({}) },
    taxCaseStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  })),
});

const makeEncryptionMock = () => ({
  safeDecrypt: jest.fn().mockReturnValue('123456789'),
  maskSSN: jest.fn().mockReturnValue('***-**-6789'),
});

const makeScraperMock = () => ({
  checkRefundStatus: jest.fn().mockResolvedValue(mockScrapeSuccess),
});

const makeMapperMock = () => ({
  map: jest.fn().mockReturnValue(FederalStatusNew.taxes_en_proceso),
});

const makeNotificationsMock = () => ({
  sendStatusUpdateNotification: jest.fn().mockResolvedValue(undefined),
});

const makeSupabaseMock = () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://supabase.co/signed-url'),
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('IrsMonitorService', () => {
  let service: IrsMonitorService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let scraper: ReturnType<typeof makeScraperMock>;
  let mapper: ReturnType<typeof makeMapperMock>;
  let encryption: ReturnType<typeof makeEncryptionMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    scraper = makeScraperMock();
    mapper = makeMapperMock();
    encryption = makeEncryptionMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IrsMonitorService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: IrsScraperService, useValue: scraper },
        { provide: IrsStatusMapperService, useValue: mapper },
        { provide: NotificationsService, useValue: makeNotificationsMock() },
        { provide: SupabaseService, useValue: makeSupabaseMock() },
      ],
    }).compile();

    service = module.get<IrsMonitorService>(IrsMonitorService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── runCheck ──────────────────────────────────────────────────────────────

  describe('runCheck()', () => {
    it('returns success when scraper succeeds', async () => {
      const result = await service.runCheck(CASE_ID, ADMIN_ID);
      expect(result.success).toBe(true);
      expect(result.rawStatus).toBe('Return Received');
    });

    it('throws NotFoundException when taxCase does not exist', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(null);
      await expect(service.runCheck(CASE_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns error when SSN cannot be decrypted', async () => {
      encryption.safeDecrypt.mockReturnValue(null);
      const result = await service.runCheck(CASE_ID, ADMIN_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('SSN');
    });

    it('retries once on error result', async () => {
      scraper.checkRefundStatus
        .mockResolvedValueOnce(mockScrapeError)
        .mockResolvedValueOnce(mockScrapeSuccess);

      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledTimes(2);
    });

    it('retries once on timeout result', async () => {
      scraper.checkRefundStatus
        .mockResolvedValueOnce(mockScrapeTimeout)
        .mockResolvedValueOnce(mockScrapeSuccess);

      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledTimes(2);
    });

    it('passes filingStatus to scraper on first call', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledWith(
        expect.objectContaining({ filingStatus: 'single' }),
      );
    });

    it('passes filingStatus to scraper on retry call', async () => {
      scraper.checkRefundStatus
        .mockResolvedValueOnce(mockScrapeError)
        .mockResolvedValueOnce(mockScrapeSuccess);

      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ filingStatus: 'single' }),
      );
    });

    it('does NOT retry on not_found result', async () => {
      scraper.checkRefundStatus.mockResolvedValue({
        ...mockScrapeSuccess,
        result: IrsCheckResult.not_found,
      });

      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledTimes(1);
    });

    it('saves check record with trigger parameter (not hardcoded manual)', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID, IrsCheckTrigger.schedule);

      expect(prisma.irsCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggeredBy: IrsCheckTrigger.schedule }),
        }),
      );
    });

    it('saves manual trigger when called without trigger param', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(prisma.irsCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggeredBy: IrsCheckTrigger.manual }),
        }),
      );
    });
  });

  // ─── runAllChecks mutex ────────────────────────────────────────────────────

  describe('runAllChecks() mutex', () => {
    it('runs normally when not already running', async () => {
      const result = await service.runAllChecks();
      expect(result.total).toBe(1);
    });

    it('skips duplicate run when already in progress', async () => {
      // Slow down the scraper so the first call doesn't finish immediately
      scraper.checkRefundStatus.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockScrapeSuccess), 50)),
      );

      // Start first run (don't await)
      const first = service.runAllChecks();
      // Immediately trigger second run
      const second = await service.runAllChecks();

      expect(second).toEqual({ total: 0, succeeded: 0, failed: 0 });

      await first; // let it finish
    });

    it('resets mutex after completion so next run can proceed', async () => {
      await service.runAllChecks();
      const result = await service.runAllChecks();
      expect(result.total).toBe(1); // ran normally, not skipped
    });

    it('resets mutex even if scraper throws', async () => {
      scraper.checkRefundStatus.mockRejectedValueOnce(new Error('Playwright crash'));

      await service.runAllChecks(); // should not throw

      // Second run should proceed normally
      scraper.checkRefundStatus.mockResolvedValue(mockScrapeSuccess);
      const result = await service.runAllChecks();
      expect(result.total).toBe(1);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns changesLast24h count', async () => {
      prisma.irsCheck.count.mockResolvedValue(5);
      const stats = await service.getStats();
      expect(stats.changesLast24h).toBe(5);
    });

    it('queries with statusChanged=true filter', async () => {
      await service.getStats();
      expect(prisma.irsCheck.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ statusChanged: true }),
        }),
      );
    });
  });

  // ─── getScreenshotUrl ─────────────────────────────────────────────────────

  describe('getScreenshotUrl()', () => {
    it('returns signed URL for existing screenshot', async () => {
      const result = await service.getScreenshotUrl('check-id-1');
      expect(result.url).toContain('supabase');
    });

    it('throws NotFoundException when check has no screenshot', async () => {
      prisma.irsCheck.findUnique.mockResolvedValue({ id: 'check-id-1', screenshotPath: null });
      await expect(service.getScreenshotUrl('check-id-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when check does not exist', async () => {
      prisma.irsCheck.findUnique.mockResolvedValue(null);
      await expect(service.getScreenshotUrl('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
