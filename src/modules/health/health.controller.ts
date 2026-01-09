import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /**
   * Health check endpoint for uptime monitoring
   * Use with UptimeRobot/Better Stack to prevent Railway sleep
   */
  @Get()
  async check() {
    const startTime = Date.now();

    // Light DB query to keep connection warm
    await this.prisma.$queryRaw`SELECT 1`;

    const dbLatency = Date.now() - startTime;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dbLatency: `${dbLatency}ms`,
    };
  }

  /**
   * Detailed health check for debugging
   */
  @Get('detailed')
  async detailed() {
    const checks: Record<string, any> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
    };

    // Database check
    try {
      const startTime = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'connected',
        latency: `${Date.now() - startTime}ms`,
      };
    } catch (error) {
      checks.database = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      checks.status = 'degraded';
    }

    return checks;
  }
}
