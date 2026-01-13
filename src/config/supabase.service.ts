import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logStorageSuccess, logStorageError } from '../common/utils/storage-logger';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be defined');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  async uploadFile(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string,
  ) {
    const startTime = Date.now();

    logStorageSuccess(this.logger, {
      operation: 'STORAGE_UPLOAD',
      bucket,
      storagePath: path,
      fileSize: file.length,
      mimeType: contentType,
    });

    try {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .upload(path, file, {
          contentType,
          upsert: false,
        });

      if (error) {
        logStorageError(this.logger, {
          operation: 'STORAGE_UPLOAD_FAILED',
          bucket,
          storagePath: path,
          fileSize: file.length,
          mimeType: contentType,
          error: error.message,
          durationMs: Date.now() - startTime,
        });
        throw error;
      }

      logStorageSuccess(this.logger, {
        operation: 'STORAGE_UPLOAD_SUCCESS',
        bucket,
        storagePath: path,
        fileSize: file.length,
        durationMs: Date.now() - startTime,
      });

      return data;
    } catch (err) {
      logStorageError(this.logger, {
        operation: 'STORAGE_UPLOAD_FAILED',
        bucket,
        storagePath: path,
        error: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  async getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      logStorageError(this.logger, {
        operation: 'STORAGE_SIGNED_URL',
        bucket,
        storagePath: path,
        error: error.message,
      });
      throw error;
    }

    logStorageSuccess(this.logger, {
      operation: 'STORAGE_SIGNED_URL',
      bucket,
      storagePath: path,
      expiresIn,
    });

    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string) {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);

    if (error) {
      logStorageError(this.logger, {
        operation: 'STORAGE_DELETE_FAILED',
        bucket,
        storagePath: path,
        error: error.message,
      });
      throw error;
    }

    logStorageSuccess(this.logger, {
      operation: 'STORAGE_DELETE',
      bucket,
      storagePath: path,
    });
  }

  /**
   * List all files in a bucket folder recursively.
   * Used for orphan file detection.
   */
  async listFiles(
    bucket: string,
    folder: string = '',
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ name: string; id: string; created_at: string; metadata: Record<string, unknown> }[]> {
    const { limit = 1000, offset = 0 } = options;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(folder, {
        limit,
        offset,
        sortBy: { column: 'created_at', order: 'asc' },
      });

    if (error) {
      this.logger.error(`Failed to list files in ${bucket}/${folder}: ${error.message}`);
      throw error;
    }

    return data || [];
  }

  /**
   * List all files in a bucket recursively by traversing folders.
   * Returns full paths relative to bucket root.
   */
  async listAllFiles(bucket: string): Promise<string[]> {
    const allFiles: string[] = [];

    const traverseFolder = async (folderPath: string) => {
      const items = await this.listFiles(bucket, folderPath);

      for (const item of items) {
        const fullPath = folderPath ? `${folderPath}/${item.name}` : item.name;

        // If item has no id, it's a folder (Supabase convention)
        if (!item.id) {
          await traverseFolder(fullPath);
        } else {
          allFiles.push(fullPath);
        }
      }
    };

    await traverseFolder('');
    return allFiles;
  }
}
