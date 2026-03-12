import { Controller, Get, Post, UseGuards, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name);

  constructor(private readonly knowledgeService: KnowledgeService) {}

  /**
   * GET /admin/knowledge/status
   * Returns how many chunks are currently stored in the vector DB
   */
  @Get('status')
  async status() {
    const chunkCount = await this.knowledgeService.getChunkCount();
    return { chunkCount };
  }

  /**
   * POST /admin/knowledge/ingest
   * Re-reads the knowledge base markdown file, re-embeds all chunks,
   * and overwrites the knowledge_chunks table. Call this after updating
   * the N8N-BOT-KNOWLEDGE-BASE.md file and deploying.
   */
  @Post('ingest')
  async ingest() {
    const filePath = path.join(process.cwd(), 'knowledge', 'N8N-BOT-KNOWLEDGE-BASE.md');

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Knowledge base file not found at: ${filePath}`);
    }

    const start = Date.now();
    this.logger.log(`Starting knowledge ingestion from: ${filePath}`);

    const markdown = fs.readFileSync(filePath, 'utf8');
    const chunks = this.knowledgeService.parseMarkdownIntoChunks(markdown);
    const chunksIngested = await this.knowledgeService.ingestKnowledge(chunks);
    const durationMs = Date.now() - start;

    this.logger.log(`Ingestion complete: ${chunksIngested} chunks in ${durationMs}ms`);

    return {
      success: true,
      chunksIngested,
      durationMs,
    };
  }
}
