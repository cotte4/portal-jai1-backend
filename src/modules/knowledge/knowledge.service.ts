import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmbeddingsService } from './embeddings.service';

export interface KnowledgeChunk {
  id: string;
  section: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

interface ChunkInput {
  section: string;
  content: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Parse markdown knowledge base into sections
   */
  parseMarkdownIntoChunks(markdown: string): ChunkInput[] {
    const chunks: ChunkInput[] = [];
    const lines = markdown.split('\n');

    let currentSection = 'General';
    let currentSubsection = '';
    let currentContent: string[] = [];

    const flushChunk = () => {
      const content = currentContent.join('\n').trim();
      if (content.length > 50) {
        // Only add chunks with meaningful content
        chunks.push({
          section: currentSubsection || currentSection,
          content,
          metadata: {
            mainSection: currentSection,
            subsection: currentSubsection || undefined,
          },
        });
      }
      currentContent = [];
    };

    for (const line of lines) {
      // Main section (## TITLE)
      if (line.startsWith('## ')) {
        flushChunk();
        currentSection = line.replace('## ', '').trim();
        currentSubsection = '';
        continue;
      }

      // Subsection (### Title)
      if (line.startsWith('### ')) {
        flushChunk();
        currentSubsection = line.replace('### ', '').trim();
        continue;
      }

      // Skip table of contents and index
      if (line.includes('INDICE') || line.match(/^\d+\.\s*\[/)) {
        continue;
      }

      // Add content line
      currentContent.push(line);
    }

    // Flush remaining content
    flushChunk();

    return chunks;
  }

  /**
   * Ingest knowledge base chunks with embeddings
   */
  async ingestKnowledge(chunks: ChunkInput[]): Promise<number> {
    this.logger.log(`Ingesting ${chunks.length} knowledge chunks...`);

    // Clear existing knowledge
    await this.prisma.$executeRaw`TRUNCATE TABLE knowledge_chunks`;

    // Generate embeddings for all chunks
    const texts = chunks.map((c) => `${c.section}\n\n${c.content}`);
    const embeddings = await this.embeddings.generateEmbeddings(texts);

    // Insert chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const embeddingStr = this.embeddings.formatForPg(embedding);

      await this.prisma.$executeRaw`
        INSERT INTO knowledge_chunks (section, content, embedding, metadata)
        VALUES (
          ${chunk.section},
          ${chunk.content},
          ${embeddingStr}::vector,
          ${JSON.stringify(chunk.metadata || {})}::jsonb
        )
      `;

      if ((i + 1) % 10 === 0) {
        this.logger.debug(`Inserted ${i + 1}/${chunks.length} chunks`);
      }
    }

    this.logger.log(`Successfully ingested ${chunks.length} knowledge chunks`);
    return chunks.length;
  }

  /**
   * Search for relevant knowledge chunks using semantic similarity
   */
  async searchKnowledge(query: string, limit = 5): Promise<KnowledgeChunk[]> {
    // Generate embedding for the query
    const queryEmbedding = await this.embeddings.generateEmbedding(query);
    const embeddingStr = this.embeddings.formatForPg(queryEmbedding);

    // Search using cosine similarity
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        section: string;
        content: string;
        metadata: Record<string, unknown>;
        similarity: number;
      }>
    >`
      SELECT
        id,
        section,
        content,
        metadata,
        1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;

    return results.map((r) => ({
      id: r.id,
      section: r.section,
      content: r.content,
      metadata: r.metadata,
      similarity: Number(r.similarity),
    }));
  }

  /**
   * Get context string for chatbot from relevant chunks
   */
  async getContextForQuery(query: string, maxChunks = 3): Promise<string> {
    const chunks = await this.searchKnowledge(query, maxChunks);

    if (chunks.length === 0) {
      return '';
    }

    // Filter out low-relevance chunks (similarity < 0.3)
    const relevantChunks = chunks.filter((c) => c.similarity && c.similarity > 0.3);

    if (relevantChunks.length === 0) {
      return '';
    }

    // Format context for the LLM
    const contextParts = relevantChunks.map(
      (c) => `--- ${c.section} ---\n${c.content}`,
    );

    return `Información relevante de la base de conocimiento:\n\n${contextParts.join('\n\n')}`;
  }

  /**
   * Get count of stored chunks
   */
  async getChunkCount(): Promise<number> {
    const result = await this.prisma.knowledgeChunk.count();
    return result;
  }
}
