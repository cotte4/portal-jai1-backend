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
    console.log('Chatbot request received');
    console.log('N8N_WEBHOOK_URL env:', process.env.N8N_WEBHOOK_URL);
    console.log('Using webhook URL:', this.webhookUrl);
    console.log('Message:', body.message);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000);

      const requestBody = JSON.stringify({
        message: body.message,
        history: body.history || [],
      });
      console.log('Request body:', requestBody);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('n8n response status:', response.status);
      console.log('n8n response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

      // Clone the response to read it twice if needed
      const responseClone = response.clone();

      let responseText: string;
      try {
        responseText = await response.text();
      } catch (textError) {
        console.error('Error reading response text:', textError);
        responseText = await responseClone.json().then(j => JSON.stringify(j)).catch(() => '');
      }

      console.log('n8n response text length:', responseText?.length);
      console.log('n8n response text:', responseText);

      if (!response.ok) {
        throw new Error(`n8n responded with status ${response.status}: ${responseText}`);
      }

      if (!responseText) {
        throw new Error('Empty response from n8n');
      }

      const data = JSON.parse(responseText);
      console.log('Parsed response:', data);
      return { response: data.response || 'No response from assistant' };
    } catch (error) {
      console.error('Chatbot error:', error.message || error);
      console.error('Full error:', error);
      return { response: 'Lo siento, el asistente no está disponible en este momento.', error: true };
    }
  }
}
