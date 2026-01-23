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
    console.log('Chatbot request received, forwarding to:', this.webhookUrl);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 second timeout

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

      console.log('n8n response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('n8n error response:', errorText);
        throw new Error(`n8n responded with status ${response.status}: ${errorText}`);
      }

      const responseText = await response.text();
      console.log('n8n response text:', responseText);

      if (!responseText) {
        throw new Error('Empty response from n8n');
      }

      const data = JSON.parse(responseText);
      return { response: data.response || 'No response from assistant' };
    } catch (error) {
      console.error('Chatbot error:', error.message || error);
      return { response: 'Lo siento, el asistente no está disponible en este momento.', error: true };
    }
  }
}
