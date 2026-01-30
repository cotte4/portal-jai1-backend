import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ChatRequestDto } from './dto/chat.dto';

@Controller('chatbot')
@UseGuards(JwtAuthGuard)
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);
  private readonly webhookUrl =
    process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/jai-chatbot';

  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async chat(@Body() body: ChatRequestDto) {
    try {
      // Get relevant context from knowledge base
      let context = '';
      try {
        context = await this.knowledgeService.getContextForQuery(body.message, 3);
        if (context) {
          this.logger.debug(`Found relevant context for query: ${body.message.slice(0, 50)}...`);
        }
      } catch (err) {
        // If RAG fails, continue without context
        this.logger.warn(`Failed to get RAG context: ${err.message}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body.message,
          history: body.history || [],
          context, // Add knowledge base context for N8N
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`n8n responded with status ${response.status}`);
      }

      if (!responseText) {
        throw new Error('Empty response from n8n');
      }

      const data = JSON.parse(responseText);
      // n8n AI Agent returns 'output', but we normalize to 'response'
      return { response: data.output || data.response || 'No response from assistant' };
    } catch (error) {
      this.logger.error('Chatbot error:', error.message || error);
      return { response: 'Lo siento, el asistente no está disponible en este momento.', error: true };
    }
  }
}
