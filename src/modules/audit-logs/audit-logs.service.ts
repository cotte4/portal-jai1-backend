import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditLogFiltersDto, ExportFiltersDto } from './dto';

interface LogParams {
  action: AuditAction;
  userId?: string;
  targetUserId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create an audit log entry
   * This method is designed to be called from other services
   */
  async log(params: LogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: params.action,
          userId: params.userId,
          targetUserId: params.targetUserId,
          details: params.details as Prisma.InputJsonValue,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (error) {
      // Log errors but don't throw - audit logging should not break the main flow
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Find all audit logs with filters and pagination
   */
  async findAll(filters: AuditLogFiltersDto) {
    const where: Prisma.AuditLogWhereInput = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.targetUserId) {
      where.targetUserId = filters.targetUserId;
    }

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.createdAt.lte = new Date(filters.dateTo);
      }
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Fetch user info for display
    const userIds = new Set<string>();
    logs.forEach((log) => {
      if (log.userId) userIds.add(log.userId);
      if (log.targetUserId) userIds.add(log.targetUserId);
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        userId: log.userId,
        userName: log.userId
          ? `${userMap.get(log.userId)?.firstName || ''} ${userMap.get(log.userId)?.lastName || ''}`.trim() || null
          : null,
        userEmail: log.userId ? userMap.get(log.userId)?.email || null : null,
        targetUserId: log.targetUserId,
        targetUserName: log.targetUserId
          ? `${userMap.get(log.targetUserId)?.firstName || ''} ${userMap.get(log.targetUserId)?.lastName || ''}`.trim() || null
          : null,
        targetUserEmail: log.targetUserId
          ? userMap.get(log.targetUserId)?.email || null
          : null,
        details: log.details,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find all logs for a specific user (as actor or target)
   */
  async findByUser(userId: string, page: number = 1, limit: number = 50) {
    const where: Prisma.AuditLogWhereInput = {
      OR: [{ userId }, { targetUserId: userId }],
    };

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        userId: log.userId,
        targetUserId: log.targetUserId,
        details: log.details,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get statistics for audit logs
   */
  async getStats(dateFrom?: string, dateTo?: string) {
    const where: Prisma.AuditLogWhereInput = {};

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    // Get total count
    const totalLogs = await this.prisma.auditLog.count({ where });

    // Get counts by action
    const actionCounts = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    });

    // Get daily counts for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentLogs = await this.prisma.auditLog.findMany({
      where: {
        ...where,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true },
    });

    // Group by day
    const dailyCounts: Record<string, number> = {};
    recentLogs.forEach((log) => {
      const day = log.createdAt.toISOString().split('T')[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });

    // Get top actors (users who performed most actions)
    const topActors = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where: { ...where, userId: { not: null } },
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // Get user details for top actors
    const actorIds = topActors
      .map((a) => a.userId)
      .filter((id): id is string => id !== null);

    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const actorMap = new Map(actors.map((a) => [a.id, a]));

    return {
      totalLogs,
      actionBreakdown: actionCounts.map((ac) => ({
        action: ac.action,
        count: ac._count.action,
      })),
      dailyCounts: Object.entries(dailyCounts)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      topActors: topActors.map((ta) => ({
        userId: ta.userId,
        userName: ta.userId
          ? `${actorMap.get(ta.userId)?.firstName || ''} ${actorMap.get(ta.userId)?.lastName || ''}`.trim()
          : null,
        email: ta.userId ? actorMap.get(ta.userId)?.email : null,
        actionCount: ta._count.userId,
      })),
    };
  }

  /**
   * Export logs to CSV format
   */
  async exportToCsv(filters: ExportFiltersDto): Promise<string> {
    const where: Prisma.AuditLogWhereInput = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.targetUserId) {
      where.targetUserId = filters.targetUserId;
    }

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.createdAt.lte = new Date(filters.dateTo);
      }
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000, // Limit export to 10k records
    });

    // Fetch user info
    const userIds = new Set<string>();
    logs.forEach((log) => {
      if (log.userId) userIds.add(log.userId);
      if (log.targetUserId) userIds.add(log.targetUserId);
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Build CSV
    const headers = [
      'ID',
      'Timestamp',
      'Action',
      'User ID',
      'User Name',
      'User Email',
      'Target User ID',
      'Target User Name',
      'Target User Email',
      'IP Address',
      'Details',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.createdAt.toISOString(),
      log.action,
      log.userId || '',
      log.userId
        ? `${userMap.get(log.userId)?.firstName || ''} ${userMap.get(log.userId)?.lastName || ''}`.trim()
        : '',
      log.userId ? userMap.get(log.userId)?.email || '' : '',
      log.targetUserId || '',
      log.targetUserId
        ? `${userMap.get(log.targetUserId)?.firstName || ''} ${userMap.get(log.targetUserId)?.lastName || ''}`.trim()
        : '',
      log.targetUserId ? userMap.get(log.targetUserId)?.email || '' : '',
      log.ipAddress || '',
      log.details ? JSON.stringify(log.details) : '',
    ]);

    // Escape CSV values
    const escapeCSV = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const csvLines = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => escapeCSV(String(cell))).join(',')),
    ];

    return csvLines.join('\n');
  }

  /**
   * Get available audit actions (for filters)
   */
  getAvailableActions(): AuditAction[] {
    return Object.values(AuditAction);
  }
}
