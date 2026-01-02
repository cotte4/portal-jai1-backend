import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
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
    console.log(`Uploading file to bucket: ${bucket}, path: ${path}, size: ${file.length}, type: ${contentType}`);

    try {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .upload(path, file, {
          contentType,
          upsert: false,
        });

      if (error) {
        console.error('Supabase upload error:', error);
        throw error;
      }

      console.log('Supabase upload successful:', data);
      return data;
    } catch (err) {
      console.error('Supabase upload exception:', err);
      throw err;
    }
  }

  async getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string) {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);

    if (error) throw error;
  }
}
