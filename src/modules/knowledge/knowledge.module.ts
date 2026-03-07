import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { EmbeddingsService } from './embeddings.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  providers: [KnowledgeService, EmbeddingsService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
