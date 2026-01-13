import { Injectable } from '@nestjs/common';
import { DocumentType as PrismaDocumentType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Storage Path Service
 *
 * Centralized utility for generating consistent storage paths in Supabase.
 *
 * Directory Structure:
 *
 * documents/
 * └── {userId}/
 *     └── {taxYear}/
 *         ├── w2/
 *         │   └── {uuid}.ext
 *         ├── payment_proof/
 *         │   └── {uuid}.ext
 *         ├── other/
 *         │   └── {uuid}.ext
 *         └── estimates/
 *             └── {uuid}.ext
 *
 * profile-pictures/
 * └── {userId}/
 *     └── {uuid}.ext
 */

// Re-export Prisma's DocumentType for convenience
export type DocumentType = PrismaDocumentType;

export interface StoragePathOptions {
  userId: string;
  taxYear?: number;
  documentType?: DocumentType | 'estimates';
  originalFileName: string;
}

@Injectable()
export class StoragePathService {
  /**
   * Buckets used in the application
   */
  static readonly BUCKETS = {
    DOCUMENTS: 'documents',
    PROFILE_PICTURES: 'profile-pictures',
  } as const;

  /**
   * Generate a storage path for a document
   * Format: {userId}/{taxYear}/{documentType}/{uuid}.{ext}
   */
  generateDocumentPath(options: StoragePathOptions): string {
    const { userId, taxYear, documentType, originalFileName } = options;
    const year = taxYear || new Date().getFullYear();
    const type = documentType || 'other';
    const extension = this.getFileExtension(originalFileName);
    const uniqueId = uuidv4();

    return `${userId}/${year}/${type}/${uniqueId}.${extension}`;
  }

  /**
   * Generate a storage path for W2 estimate scans
   * Format: {userId}/{taxYear}/estimates/{uuid}.{ext}
   */
  generateEstimatePath(userId: string, originalFileName: string, taxYear?: number): string {
    return this.generateDocumentPath({
      userId,
      taxYear,
      documentType: 'estimates',
      originalFileName,
    });
  }

  /**
   * Generate a storage path for profile pictures
   * Format: {userId}/{uuid}.{ext}
   */
  generateProfilePicturePath(userId: string, originalFileName: string): string {
    const extension = this.getFileExtension(originalFileName);
    const uniqueId = uuidv4();

    return `${userId}/${uniqueId}.${extension}`;
  }

  /**
   * Parse a storage path to extract metadata
   * Useful for debugging or auditing
   */
  parseDocumentPath(path: string): {
    userId: string;
    taxYear: number;
    documentType: string;
    fileName: string;
  } | null {
    const parts = path.split('/');
    if (parts.length !== 4) return null;

    return {
      userId: parts[0],
      taxYear: parseInt(parts[1], 10),
      documentType: parts[2],
      fileName: parts[3],
    };
  }

  /**
   * Get file extension from filename, defaulting to 'bin' if none found
   */
  private getFileExtension(fileName: string): string {
    const parts = fileName.split('.');
    if (parts.length > 1) {
      return parts.pop()!.toLowerCase();
    }
    return 'bin';
  }

  /**
   * Validate that a path follows the expected format
   */
  isValidDocumentPath(path: string): boolean {
    const parsed = this.parseDocumentPath(path);
    if (!parsed) return false;

    const validTypes = ['w2', 'payment_proof', 'other', 'estimates'];
    return (
      parsed.userId.length > 0 &&
      !isNaN(parsed.taxYear) &&
      parsed.taxYear >= 2000 &&
      parsed.taxYear <= 2100 &&
      validTypes.includes(parsed.documentType) &&
      parsed.fileName.length > 0
    );
  }
}
