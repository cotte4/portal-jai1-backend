import { Test, TestingModule } from '@nestjs/testing';
import { StorageCleanupService } from './storage-cleanup.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';

describe('StorageCleanupService', () => {
  let service: StorageCleanupService;
  let prisma: any;
  let supabase: any;
  let storagePath: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      document: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      w2Estimate: {
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    supabase = {
      listAllFiles: jest.fn(),
      deleteFile: jest.fn(),
    };

    storagePath = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabase },
        { provide: StoragePathService, useValue: storagePath },
      ],
    }).compile();

    service = module.get<StorageCleanupService>(StorageCleanupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('scanForOrphans', () => {
    it('should return empty result when no orphans found', async () => {
      // Storage has files that all exist in DB
      supabase.listAllFiles
        .mockResolvedValueOnce(['users/1/doc.pdf']) // documents bucket
        .mockResolvedValueOnce([]); // profile pictures bucket (empty)
      prisma.document.findMany.mockResolvedValue([{ storagePath: 'users/1/doc.pdf' }]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.scanForOrphans();

      expect(result.dryRun).toBe(true);
      expect(result.totalOrphans).toBe(0);
      expect(result.documentsOrphans).toHaveLength(0);
    });

    it('should find orphans in documents bucket', async () => {
      // Storage has a file not in DB
      supabase.listAllFiles
        .mockResolvedValueOnce(['users/1/orphan.pdf', 'users/1/valid.pdf'])
        .mockResolvedValueOnce([]); // profile pictures
      prisma.document.findMany.mockResolvedValue([{ storagePath: 'users/1/valid.pdf' }]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.scanForOrphans();

      expect(result.documentsOrphans).toHaveLength(1);
      expect(result.documentsOrphans[0].path).toBe('users/1/orphan.pdf');
      expect(result.documentsOrphans[0].reason).toBe('No matching database record');
    });

    it('should find orphans in profile pictures bucket', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce([]) // documents
        .mockResolvedValueOnce(['users/1/old-avatar.jpg', 'users/2/avatar.jpg']); // profile pictures
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([{ profilePicturePath: 'users/2/avatar.jpg' }]);

      const result = await service.scanForOrphans();

      expect(result.profilePicturesOrphans).toHaveLength(1);
      expect(result.profilePicturesOrphans[0].path).toBe('users/1/old-avatar.jpg');
    });

    it('should handle W2 estimate paths', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['users/1/estimates/w2.jpg'])
        .mockResolvedValueOnce([]);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([{ w2StoragePath: 'users/1/estimates/w2.jpg' }]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.scanForOrphans();

      expect(result.documentsOrphans).toHaveLength(0);
      expect(result.totalOrphans).toBe(0);
    });

    it('should use custom grace period', async () => {
      supabase.listAllFiles.mockResolvedValue([]);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.scanForOrphans(72);

      expect(result.gracePeriodHours).toBe(72);
    });

    it('should scan only specific bucket when specified', async () => {
      supabase.listAllFiles.mockResolvedValue([]);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);

      await service.scanForOrphans(48, 'documents');

      // Should only call listAllFiles for documents bucket
      expect(supabase.listAllFiles).toHaveBeenCalledTimes(1);
      expect(supabase.listAllFiles).toHaveBeenCalledWith('documents');
    });

    it('should handle errors gracefully', async () => {
      supabase.listAllFiles.mockRejectedValue(new Error('Storage error'));

      const result = await service.scanForOrphans();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Storage error');
    });

    it('should calculate total orphans correctly', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['doc1.pdf', 'doc2.pdf'])
        .mockResolvedValueOnce(['pic1.jpg']);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.scanForOrphans();

      expect(result.totalOrphans).toBe(3);
      expect(result.documentsOrphans).toHaveLength(2);
      expect(result.profilePicturesOrphans).toHaveLength(1);
    });
  });

  describe('executeCleanup', () => {
    it('should delete orphan files', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['orphan.pdf'])
        .mockResolvedValueOnce([]);
      supabase.deleteFile.mockResolvedValue(undefined);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.executeCleanup();

      expect(result.dryRun).toBe(false);
      expect(result.deletedCount).toBe(1);
      expect(supabase.deleteFile).toHaveBeenCalledWith('documents', 'orphan.pdf');
    });

    it('should respect maxFiles limit', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['file1.pdf', 'file2.pdf', 'file3.pdf'])
        .mockResolvedValueOnce([]);
      supabase.deleteFile.mockResolvedValue(undefined);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.executeCleanup(48, 2);

      expect(result.deletedCount).toBe(2);
      expect(supabase.deleteFile).toHaveBeenCalledTimes(2);
    });

    it('should handle deletion errors', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['orphan.pdf'])
        .mockResolvedValueOnce([]);
      supabase.deleteFile.mockRejectedValue(new Error('Delete failed'));
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.executeCleanup();

      expect(result.deletedCount).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Delete failed');
    });

    it('should delete nothing when no orphans', async () => {
      supabase.listAllFiles.mockResolvedValue([]);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.executeCleanup();

      expect(result.deletedCount).toBe(0);
      expect(supabase.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('scheduledCleanup', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should skip cleanup when disabled via env', async () => {
      process.env.STORAGE_CLEANUP_ENABLED = 'false';

      await service.scheduledCleanup();

      expect(supabase.listAllFiles).not.toHaveBeenCalled();
    });

    it('should run cleanup when enabled', async () => {
      process.env.STORAGE_CLEANUP_ENABLED = 'true';
      supabase.listAllFiles.mockResolvedValue([]);
      prisma.document.findMany.mockResolvedValue([]);
      prisma.w2Estimate.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.scheduledCleanup();

      expect(supabase.listAllFiles).toHaveBeenCalled();
    });

    it('should handle errors in scheduled cleanup', async () => {
      process.env.STORAGE_CLEANUP_ENABLED = 'true';
      supabase.listAllFiles.mockRejectedValue(new Error('Scheduled error'));

      // Should not throw
      await expect(service.scheduledCleanup()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      supabase.listAllFiles
        .mockResolvedValueOnce(['doc1.pdf', 'doc2.pdf', 'doc3.pdf'])
        .mockResolvedValueOnce(['pic1.jpg', 'pic2.jpg']);
      prisma.document.count.mockResolvedValue(2);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.getStats();

      expect(result).toEqual({
        documentsInStorage: 3,
        documentsInDb: 2,
        profilePicsInStorage: 2,
        profilePicsInDb: 1,
      });
    });

    it('should handle empty buckets', async () => {
      supabase.listAllFiles.mockResolvedValue([]);
      prisma.document.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);

      const result = await service.getStats();

      expect(result.documentsInStorage).toBe(0);
      expect(result.documentsInDb).toBe(0);
      expect(result.profilePicsInStorage).toBe(0);
      expect(result.profilePicsInDb).toBe(0);
    });
  });
});
