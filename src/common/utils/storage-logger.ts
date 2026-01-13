import { Logger } from '@nestjs/common';

/**
 * Storage operation types for structured logging
 */
export type StorageOperation =
  | 'STORAGE_UPLOAD'
  | 'STORAGE_UPLOAD_SUCCESS'
  | 'STORAGE_UPLOAD_FAILED'
  | 'STORAGE_DOWNLOAD'
  | 'STORAGE_DOWNLOAD_DENIED'
  | 'STORAGE_DELETE'
  | 'STORAGE_DELETE_FAILED'
  | 'STORAGE_DELETE_DENIED'
  | 'STORAGE_SIGNED_URL'
  | 'DOCUMENT_UPLOAD_START'
  | 'DOCUMENT_UPLOAD_SUCCESS'
  | 'DOCUMENT_UPLOAD_FAILED'
  | 'DOCUMENT_DOWNLOAD'
  | 'DOCUMENT_DOWNLOAD_DENIED'
  | 'DOCUMENT_DELETE'
  | 'DOCUMENT_DELETE_FAILED'
  | 'DOCUMENT_DELETE_DENIED'
  | 'PROFILE_PICTURE_UPLOAD'
  | 'PROFILE_PICTURE_DELETE';

/**
 * Base interface for storage log entries
 */
export interface StorageLogEntry {
  operation: StorageOperation;
  userId?: string;
  userRole?: string;
  documentId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  bucket?: string;
  storagePath?: string;
  documentType?: string;
  taxYear?: number;
  durationMs?: number;
  error?: string;
  reason?: string;
  expiresIn?: number;
  [key: string]: unknown;
}

/**
 * Log a storage operation with structured JSON format.
 * Railway automatically parses JSON logs for filtering and searching.
 *
 * @param logger - NestJS Logger instance
 * @param level - Log level: 'log' (info), 'warn', or 'error'
 * @param entry - Structured log entry data
 */
export function logStorageOperation(
  logger: Logger,
  level: 'log' | 'warn' | 'error',
  entry: StorageLogEntry,
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Log as JSON string for Railway parsing
  logger[level](JSON.stringify(logData));
}

/**
 * Helper to log successful storage operations
 */
export function logStorageSuccess(
  logger: Logger,
  entry: StorageLogEntry,
): void {
  logStorageOperation(logger, 'log', entry);
}

/**
 * Helper to log storage warnings (access denied, validation errors)
 */
export function logStorageWarning(
  logger: Logger,
  entry: StorageLogEntry,
): void {
  logStorageOperation(logger, 'warn', entry);
}

/**
 * Helper to log storage errors (system/infrastructure failures)
 */
export function logStorageError(
  logger: Logger,
  entry: StorageLogEntry,
): void {
  logStorageOperation(logger, 'error', entry);
}
