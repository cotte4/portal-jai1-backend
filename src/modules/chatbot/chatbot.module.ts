import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [KnowledgeModule],
  controllers: [ChatbotController],
})
export class ChatbotModule {}
