import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

@Controller('chatbot')
@UseGuards(JwtAuthGuard)
export class ChatbotController {
  private readonly webhookUrl =
    process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/jai-chatbot';

  @Post()
  async chat(@Body() body: ChatRequest) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body.message,
          history: body.history || [],
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
      console.error('Chatbot error:', error.message || error);
      return { response: 'Lo siento, el asistente no está disponible en este momento.', error: true };
    }
  }
}
