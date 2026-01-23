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
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body.message,
          history: body.history || [],
        }),
      });

      if (!response.ok) {
        throw new Error(`n8n responded with status ${response.status}`);
      }

      const data = await response.json();
      return { response: data.response || 'No response from assistant' };
    } catch (error) {
      console.error('Chatbot error:', error);
      return { response: 'Lo siento, el asistente no está disponible en este momento.', error: true };
    }
  }
}
