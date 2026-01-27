import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private openai: OpenAI;
  private readonly model = 'text-embedding-3-small';
  private readonly dimensions = 1536;

  onModuleInit() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set - embeddings will not work');
      return;
    }
    this.openai = new OpenAI({ apiKey });
    this.logger.log('OpenAI embeddings service initialized');
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - check OPENAI_API_KEY');
    }

    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - check OPENAI_API_KEY');
    }

    if (texts.length === 0) return [];

    // OpenAI allows up to 2048 inputs per request
    const batchSize = 100;
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const response = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });

      for (const item of response.data) {
        embeddings.push(item.embedding);
      }

      this.logger.debug(`Embedded batch ${i / batchSize + 1}/${Math.ceil(texts.length / batchSize)}`);
    }

    return embeddings;
  }

  /**
   * Format embedding array for PostgreSQL vector type
   */
  formatForPg(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
