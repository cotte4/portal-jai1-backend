import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ColoradoMonitorController } from './colorado-monitor.controller';
import { ColoradoMonitorService } from './colorado-monitor.service';
import { IrsCheckTrigger, StateStatusNew } from '@prisma/client';

// ─── Mock service ─────────────────────────────────────────────────────────────

const mockService = () => ({
  getStats: jest.fn().mockResolvedValue({ changesLast24h: 3 }),
  getFiledClients: jest.fn().mockResolvedValue([]),
  runAllChecks: jest.fn().mockResolvedValue({ total: 5, succeeded: 4, failed: 1 }),
  runCheck: jest.fn().mockResolvedValue({ success: true, statusChanged: false, rawStatus: 'Return Received & Being Processed' }),
  getChecks: jest.fn().mockResolvedValue([]),
  getChecksForClient: jest.fn().mockResolvedValue([]),
  exportCsv: jest.fn().mockResolvedValue('col1,col2\nval1,val2'),
  approveCheck: jest.fn().mockResolvedValue({ applied: true, previousStatus: 'taxes_en_proceso', newStatus: 'deposito_directo' }),
  dismissCheck: jest.fn().mockResolvedValue({ dismissed: true }),
  getScreenshotUrl: jest.fn().mockResolvedValue({ url: 'https://signed-url.example.com' }),
});

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const MOCK_ADMIN = { id: 'admin-uuid', role: 'admin' };

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ColoradoMonitorController', () => {
  let controller: ColoradoMonitorController;
  let service: ReturnType<typeof mockService>;

  beforeEach(async () => {
    service = mockService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ColoradoMonitorController],
      providers: [{ provide: ColoradoMonitorService, useValue: service }],
    }).compile();

    controller = module.get<ColoradoMonitorController>(ColoradoMonitorController);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET /stats ────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns changesLast24h', async () => {
      const result = await controller.getStats();
      expect(result.changesLast24h).toBe(3);
    });
  });

  // ─── GET /clients ──────────────────────────────────────────────────────────

  describe('getFiledClients()', () => {
    it('delegates to service', async () => {
      await controller.getFiledClients();
      expect(service.getFiledClients).toHaveBeenCalledTimes(1);
    });
  });

  // ─── POST /check-all ──────────────────────────────────────────────────────

  describe('runCheckAll()', () => {
    it('returns { started: true } immediately', async () => {
      const result = await controller.runCheckAll(MOCK_ADMIN);
      expect(result).toEqual({ started: true });
    });

    it('calls runAllChecks with manual trigger and admin id', async () => {
      await controller.runCheckAll(MOCK_ADMIN);
      await new Promise(resolve => setImmediate(resolve));
      expect(service.runAllChecks).toHaveBeenCalledWith(
        IrsCheckTrigger.manual,
        MOCK_ADMIN.id,
      );
    });

    it('does not throw even if service rejects', async () => {
      service.runAllChecks.mockRejectedValue(new Error('Service crashed'));
      await expect(controller.runCheckAll(MOCK_ADMIN)).resolves.toEqual({ started: true });
    });
  });

  // ─── POST /check/:taxCaseId ───────────────────────────────────────────────

  describe('runCheck()', () => {
    it('returns { started: true } immediately (fire & forget)', async () => {
      const result = await controller.runCheck(VALID_UUID, MOCK_ADMIN);
      expect(result).toEqual({ started: true });
    });

    it('calls service.runCheck with taxCaseId and adminId', async () => {
      await controller.runCheck(VALID_UUID, MOCK_ADMIN);
      await new Promise(resolve => setImmediate(resolve));
      expect(service.runCheck).toHaveBeenCalledWith(VALID_UUID, MOCK_ADMIN.id);
    });
  });

  // ─── GET /checks/:taxCaseId ───────────────────────────────────────────────

  describe('getChecksForClient()', () => {
    it('delegates to service with valid UUID', async () => {
      await controller.getChecksForClient(VALID_UUID);
      expect(service.getChecksForClient).toHaveBeenCalledWith(VALID_UUID);
    });
  });

  // ─── POST /checks/:checkId/approve ────────────────────────────────────────

  describe('approveCheck()', () => {
    it('delegates to service with checkId and adminId', async () => {
      await controller.approveCheck(VALID_UUID, MOCK_ADMIN);
      expect(service.approveCheck).toHaveBeenCalledWith(VALID_UUID, MOCK_ADMIN.id);
    });

    it('returns applied result from service', async () => {
      const result = await controller.approveCheck(VALID_UUID, MOCK_ADMIN);
      expect(result.applied).toBe(true);
    });
  });

  // ─── POST /checks/:checkId/dismiss ────────────────────────────────────────

  describe('dismissCheck()', () => {
    it('delegates to service', async () => {
      await controller.dismissCheck(VALID_UUID);
      expect(service.dismissCheck).toHaveBeenCalledWith(VALID_UUID);
    });

    it('returns dismissed result', async () => {
      const result = await controller.dismissCheck(VALID_UUID);
      expect(result.dismissed).toBe(true);
    });
  });

  // ─── GET /screenshot/:checkId ─────────────────────────────────────────────

  describe('getScreenshot()', () => {
    it('returns signed URL for valid UUID', async () => {
      const result = await controller.getScreenshot(VALID_UUID);
      expect(result.url).toContain('https://');
    });

    it('delegates to service with checkId', async () => {
      await controller.getScreenshot(VALID_UUID);
      expect(service.getScreenshotUrl).toHaveBeenCalledWith(VALID_UUID);
    });
  });

  // ─── GET /export ──────────────────────────────────────────────────────────

  describe('exportCsv()', () => {
    it('calls service.exportCsv and sends CSV response', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.exportCsv(mockRes as any);

      expect(service.exportCsv).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockRes.send).toHaveBeenCalledWith('col1,col2\nval1,val2');
    });
  });

  // ─── UUID validation (ParseUUIDPipe) ──────────────────────────────────────

  describe('ParseUUIDPipe behaviour', () => {
    const { ParseUUIDPipe } = require('@nestjs/common');

    it('rejects non-UUID string', async () => {
      const pipe = new ParseUUIDPipe();
      await expect(
        pipe.transform('not-a-uuid', { type: 'param', data: 'taxCaseId' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects path traversal attempt', async () => {
      const pipe = new ParseUUIDPipe();
      await expect(
        pipe.transform('../../etc/passwd', { type: 'param', data: 'taxCaseId' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid UUID v4', async () => {
      const pipe = new ParseUUIDPipe();
      await expect(
        pipe.transform(VALID_UUID, { type: 'param', data: 'taxCaseId' }),
      ).resolves.toBe(VALID_UUID);
    });
  });
});
