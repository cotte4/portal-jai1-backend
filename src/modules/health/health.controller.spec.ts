import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../../config/prisma.service';

/**
 * Health Controller Unit Tests
 *
 * Tests the HealthController's health check endpoints.
 * These endpoints are used by uptime monitors like UptimeRobot/Better Stack.
 */

describe('HealthController', () => {
  let controller: HealthController;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrismaService = {
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /health', () => {
    it('should return ok status when database is healthy', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.dbLatency).toBeDefined();
      expect(result.dbLatency).toMatch(/^\d+ms$/);
    });

    it('should include uptime in seconds', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.check();

      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include ISO timestamp', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.check();

      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should measure database latency', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.check();

      const latencyMs = parseInt(result.dbLatency.replace('ms', ''));
      expect(latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /health/detailed', () => {
    it('should return ok status with database connected', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.detailed();

      expect(result.status).toBe('ok');
      expect(result.database.status).toBe('connected');
      expect(result.database.latency).toBeDefined();
    });

    it('should include memory usage information', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.detailed();

      expect(result.memory).toBeDefined();
      expect(result.memory.heapUsed).toBeDefined();
      expect(result.memory.heapTotal).toBeDefined();
      expect(result.memory.rss).toBeDefined();
    });

    it('should include Node.js version', async () => {
      prismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.detailed();

      expect(result.version).toBeDefined();
      expect(result.version).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('should return degraded status when database fails', async () => {
      prismaService.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await controller.detailed();

      expect(result.status).toBe('degraded');
      expect(result.database.status).toBe('error');
      expect(result.database.error).toBe('Connection refused');
    });

    it('should handle unknown database errors gracefully', async () => {
      prismaService.$queryRaw.mockRejectedValue('Unknown error');

      const result = await controller.detailed();

      expect(result.status).toBe('degraded');
      expect(result.database.status).toBe('error');
      expect(result.database.error).toBe('Unknown error');
    });

    it('should still include uptime and timestamp when database fails', async () => {
      prismaService.$queryRaw.mockRejectedValue(new Error('Timeout'));

      const result = await controller.detailed();

      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.version).toBeDefined();
    });
  });
});
