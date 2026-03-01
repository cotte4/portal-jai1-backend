import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IrsCheckTrigger, IrsCheckResult, PaymentMethod, StateStatusNew } from '@prisma/client';
import { ColoradoMonitorService } from './colorado-monitor.service';
import { ColoradoScraperService } from './colorado-scraper.service';
import { ColoradoStatusMapperService } from './colorado-status-mapper.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../../config/supabase.service';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const CASE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ADMIN_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const CHECK_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

const mockTaxCase = {
  id: CASE_ID,
  stateStatusNew: StateStatusNew.taxes_en_proceso,
  stateActualRefund: 845,
  paymentMethod: PaymentMethod.bank_deposit,
  workState: 'Colorado',
  caseStatus: 'taxes_filed',
  clientProfile: {
    ssn: 'encrypted-ssn',
    user: {
      id: 'user-uuid',
      firstName: 'Maria',
      lastName: 'Test',
      email: 'maria@test.com',
      preferredLanguage: 'es',
    },
  },
};

const mockScrapeSuccess = {
  rawStatus: 'Return Received & Being Processed',
  details: 'Your return has been received and is being processed.',
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
  coloradoCheck: {
    create: jest.fn().mockResolvedValue({ id: CHECK_ID, ...mockScrapeSuccess }),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue({
      id: CHECK_ID,
      screenshotPath: 'checks/abc/123.png',
      statusChanged: true,
      mappedStatus: StateStatusNew.deposito_directo,
      coRawStatus: 'Refund Issued',
      taxCase: {
        id: CASE_ID,
        stateStatusNew: StateStatusNew.taxes_en_proceso,
        clientProfile: {
          user: { id: 'user-uuid', firstName: 'Maria', lastName: 'Test' },
        },
      },
    }),
    count: jest.fn().mockResolvedValue(3),
    update: jest.fn().mockResolvedValue({}),
  },
  statusHistory: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn().mockImplementation((fn) => fn({
    taxCase: { update: jest.fn().mockResolvedValue({}) },
    statusHistory: { create: jest.fn().mockResolvedValue({}) },
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
  map: jest.fn().mockReturnValue(StateStatusNew.taxes_en_proceso),
});

const makeNotificationsMock = () => ({
  create: jest.fn().mockResolvedValue(undefined),
});

const makeSupabaseMock = () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://supabase.co/signed-url'),
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ColoradoMonitorService', () => {
  let service: ColoradoMonitorService;
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
        ColoradoMonitorService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: ColoradoScraperService, useValue: scraper },
        { provide: ColoradoStatusMapperService, useValue: mapper },
        { provide: NotificationsService, useValue: makeNotificationsMock() },
        { provide: SupabaseService, useValue: makeSupabaseMock() },
      ],
    }).compile();

    service = module.get<ColoradoMonitorService>(ColoradoMonitorService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── runCheck ──────────────────────────────────────────────────────────────

  describe('runCheck()', () => {
    it('returns success when scraper succeeds', async () => {
      const result = await service.runCheck(CASE_ID, ADMIN_ID);
      expect(result.success).toBe(true);
      expect(result.rawStatus).toBe('Return Received & Being Processed');
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

    it('returns error when stateActualRefund is missing', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        stateActualRefund: null,
      });
      const result = await service.runCheck(CASE_ID, ADMIN_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('state actual refund');
    });

    it('does NOT fall back to estimatedRefund (unlike IRS)', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        stateActualRefund: null,
        estimatedRefund: 1500,
      });
      const result = await service.runCheck(CASE_ID, ADMIN_ID);
      expect(result.success).toBe(false);
      // Should NOT have called scraper at all
      expect(scraper.checkRefundStatus).not.toHaveBeenCalled();
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

    it('does NOT retry on not_found result', async () => {
      scraper.checkRefundStatus.mockResolvedValue({
        ...mockScrapeSuccess,
        result: IrsCheckResult.not_found,
      });

      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledTimes(1);
    });

    it('passes stateRefundAmount (not federal) to scraper', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(scraper.checkRefundStatus).toHaveBeenCalledWith(
        expect.objectContaining({ stateRefundAmount: 845 }),
      );
    });

    it('does NOT pass taxYear or filingStatus to scraper (CO doesn\'t need them)', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      const scraperCall = scraper.checkRefundStatus.mock.calls[0][0];
      expect(scraperCall).not.toHaveProperty('taxYear');
      expect(scraperCall).not.toHaveProperty('filingStatus');
    });

    it('saves check record with trigger parameter', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID, IrsCheckTrigger.schedule);

      expect(prisma.coloradoCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggeredBy: IrsCheckTrigger.schedule }),
        }),
      );
    });

    it('saves manual trigger when called without trigger param', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(prisma.coloradoCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggeredBy: IrsCheckTrigger.manual }),
        }),
      );
    });

    it('creates coloradoCheck record (not irsCheck)', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(prisma.coloradoCheck.create).toHaveBeenCalled();
    });

    it('saves coRawStatus field (not irsRawStatus)', async () => {
      await service.runCheck(CASE_ID, ADMIN_ID);

      expect(prisma.coloradoCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coRawStatus: 'Return Received & Being Processed',
          }),
        }),
      );
    });

    it('catches unexpected scraper crash and saves error record', async () => {
      scraper.checkRefundStatus.mockRejectedValue(new Error('Playwright OOM'));

      const result = await service.runCheck(CASE_ID, ADMIN_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Playwright OOM');
      expect(prisma.coloradoCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coRawStatus: 'Error',
            checkResult: IrsCheckResult.error,
            errorMessage: 'Playwright OOM',
          }),
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
      scraper.checkRefundStatus.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockScrapeSuccess), 50)),
      );

      const first = service.runAllChecks();
      const second = await service.runAllChecks();

      expect(second).toEqual({ total: 0, succeeded: 0, failed: 0 });

      await first;
    });

    it('resets mutex after completion so next run can proceed', async () => {
      await service.runAllChecks();
      const result = await service.runAllChecks();
      expect(result.total).toBe(1);
    });

    it('resets mutex even if scraper throws', async () => {
      scraper.checkRefundStatus.mockRejectedValueOnce(new Error('Playwright crash'));

      await service.runAllChecks();

      scraper.checkRefundStatus.mockResolvedValue(mockScrapeSuccess);
      const result = await service.runAllChecks();
      expect(result.total).toBe(1);
    });

    it('filters by workState Colorado/CO and post-filing statuses', async () => {
      await service.runAllChecks();

      expect(prisma.taxCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            caseStatus: { in: ['taxes_filed', 'case_issues'] },
            OR: [
              { workState: { equals: 'Colorado', mode: 'insensitive' } },
              { workState: { equals: 'CO', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });
  });

  // ─── getFiledClients ────────────────────────────────────────────────────────

  describe('getFiledClients()', () => {
    it('filters by post-filing statuses AND workState Colorado/CO', async () => {
      prisma.taxCase.findMany.mockResolvedValue([]);
      await service.getFiledClients();

      expect(prisma.taxCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            caseStatus: { in: ['taxes_filed', 'case_issues'] },
            OR: [
              { workState: { equals: 'Colorado', mode: 'insensitive' } },
              { workState: { equals: 'CO', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('includes coloradoChecks relation (not irsChecks)', async () => {
      prisma.taxCase.findMany.mockResolvedValue([]);
      await service.getFiledClients();

      expect(prisma.taxCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            coloradoChecks: expect.any(Object),
          }),
        }),
      );
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns changesLast24h count', async () => {
      prisma.coloradoCheck.count.mockResolvedValue(5);
      const stats = await service.getStats();
      expect(stats.changesLast24h).toBe(5);
    });

    it('queries coloradoCheck table (not irsCheck)', async () => {
      await service.getStats();
      expect(prisma.coloradoCheck.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ statusChanged: true }),
        }),
      );
    });
  });

  // ─── approveCheck ──────────────────────────────────────────────────────────

  describe('approveCheck()', () => {
    it('updates stateStatusNew (not federalStatusNew)', async () => {
      await service.approveCheck(CHECK_ID, ADMIN_ID);

      const txFn = prisma.$transaction.mock.calls[0][0];
      const mockTx = {
        taxCase: { update: jest.fn().mockResolvedValue({}) },
        statusHistory: { create: jest.fn().mockResolvedValue({}) },
      };
      await txFn(mockTx);

      expect(mockTx.taxCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stateStatusNew: StateStatusNew.deposito_directo,
          }),
        }),
      );
      // Should NOT update federal fields
      const updateData = mockTx.taxCase.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('federalStatusNew');
    });

    it('throws NotFoundException when check does not exist', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue(null);
      await expect(service.approveCheck(CHECK_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns applied=false when no status change to approve', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue({
        id: CHECK_ID,
        statusChanged: false,
        mappedStatus: null,
        taxCase: mockTaxCase,
      });

      const result = await service.approveCheck(CHECK_ID, ADMIN_ID);
      expect(result.applied).toBe(false);
    });
  });

  // ─── dismissCheck ──────────────────────────────────────────────────────────

  describe('dismissCheck()', () => {
    it('sets statusChanged to false on coloradoCheck', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue({ id: CHECK_ID });
      await service.dismissCheck(CHECK_ID);

      expect(prisma.coloradoCheck.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CHECK_ID },
          data: { statusChanged: false },
        }),
      );
    });

    it('throws NotFoundException when check does not exist', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue(null);
      await expect(service.dismissCheck(CHECK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getScreenshotUrl ─────────────────────────────────────────────────────

  describe('getScreenshotUrl()', () => {
    it('returns signed URL for existing screenshot', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue({
        screenshotPath: 'checks/abc/123.png',
      });
      const result = await service.getScreenshotUrl(CHECK_ID);
      expect(result.url).toContain('supabase');
    });

    it('throws NotFoundException when check has no screenshot', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue({ id: CHECK_ID, screenshotPath: null });
      await expect(service.getScreenshotUrl(CHECK_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when check does not exist', async () => {
      prisma.coloradoCheck.findUnique.mockResolvedValue(null);
      await expect(service.getScreenshotUrl('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
