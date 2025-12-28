import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;
  private fromEmail: string;
  private isConfigured: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail = this.configService.get<string>('EMAIL_FROM') || 'noreply@portaljai1.com';

    if (apiKey && apiKey !== 're_your_resend_api_key') {
      this.resend = new Resend(apiKey);
      this.isConfigured = true;
    } else {
      this.isConfigured = false;
      this.logger.warn('Resend API key not configured. Emails will be logged only.');
    }
  }

  private async send(options: EmailOptions): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.log(`[EMAIL MOCK] To: ${options.to}`);
      this.logger.log(`[EMAIL MOCK] Subject: ${options.subject}`);
      this.logger.log(`[EMAIL MOCK] Body: ${options.html.substring(0, 200)}...`);
      return true;
    }

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);
      return false;
    }
  }

  /**
   * Send welcome email after registration
   */
  async sendWelcomeEmail(to: string, firstName: string): Promise<boolean> {
    const portalUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #B21B43; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; background-color: #1D345D; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>¡Bienvenido a JAI1!</h1>
          </div>
          <div class="content">
            <p>Hola <strong>${firstName}</strong>,</p>
            <p>Gracias por registrarte en JAI1. Estamos listos para ayudarte a recuperar tus impuestos de tu experiencia Work & Travel.</p>
            <p><strong>Próximos pasos:</strong></p>
            <ol>
              <li>Completa tu información personal</li>
              <li>Sube tu documento W2</li>
              <li>¡Nosotros nos encargamos del resto!</li>
            </ol>
            <a href="${portalUrl}" class="button">Acceder al Portal</a>
          </div>
          <div class="footer">
            <p>¿Preguntas? Contáctanos a través del sistema de soporte.</p>
            <p>El equipo JAI1</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to,
      subject: `¡Bienvenido a JAI1, ${firstName}! 🎉`,
      html,
    });
  }

  /**
   * Send status change notification
   */
  async sendStatusChangeEmail(
    to: string,
    firstName: string,
    oldStatus: string,
    newStatus: string,
    statusMessage: string,
  ): Promise<boolean> {
    const portalUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    const statusLabels: Record<string, string> = {
      esperando_datos: 'Necesitamos tus datos y documentos',
      cuenta_en_revision: 'Estamos revisando tu información',
      taxes_en_proceso: '¡Estamos trabajando en tu declaración!',
      taxes_en_camino: 'Tu reembolso está en camino',
      taxes_depositados: '¡Reembolso depositado en tu cuenta!',
      pago_realizado: 'Gracias por tu pago',
      en_verificacion: 'El IRS está verificando tu caso',
      taxes_finalizados: '¡Proceso completado! Gracias por confiar en JAI1',
    };

    const oldStatusLabel = statusLabels[oldStatus] || oldStatus;
    const newStatusLabel = statusLabels[newStatus] || newStatus;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #B21B43; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .status-box { background-color: white; border-left: 4px solid #1D345D; padding: 15px; margin: 15px 0; }
          .button { display: inline-block; background-color: #1D345D; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Actualización de tu Trámite</h1>
          </div>
          <div class="content">
            <p>Hola <strong>${firstName}</strong>,</p>
            <p>El estado de tu trámite ha sido actualizado:</p>
            <div class="status-box">
              <p><strong>Estado anterior:</strong> ${oldStatusLabel}</p>
              <p><strong>Estado actual:</strong> ${newStatusLabel}</p>
            </div>
            ${statusMessage ? `<p>${statusMessage}</p>` : ''}
            <a href="${portalUrl}" class="button">Ver Detalles en el Portal</a>
          </div>
          <div class="footer">
            <p>El equipo JAI1</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to,
      subject: `Actualización de tu trámite - ${newStatusLabel}`,
      html,
    });
  }

  /**
   * Send ticket response notification
   */
  async sendTicketResponseEmail(
    to: string,
    firstName: string,
    ticketSubject: string,
    responseMessage: string,
  ): Promise<boolean> {
    const portalUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #B21B43; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .message-box { background-color: white; border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .button { display: inline-block; background-color: #1D345D; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Respuesta a tu Consulta</h1>
          </div>
          <div class="content">
            <p>Hola <strong>${firstName}</strong>,</p>
            <p>Hemos respondido a tu ticket: <strong>${ticketSubject}</strong></p>
            <div class="message-box">
              <p>${responseMessage}</p>
            </div>
            <a href="${portalUrl}/support" class="button">Ver Conversación Completa</a>
          </div>
          <div class="footer">
            <p>El equipo JAI1</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to,
      subject: `Respuesta a tu consulta: ${ticketSubject}`,
      html,
    });
  }

  /**
   * Send notification to admin about new client
   */
  async sendNewClientNotification(
    adminEmail: string,
    clientName: string,
    clientEmail: string,
  ): Promise<boolean> {
    const portalUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1D345D; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .client-info { background-color: white; border: 1px solid #ddd; padding: 15px; margin: 15px 0; }
          .button { display: inline-block; background-color: #B21B43; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Nuevo Cliente Registrado</h1>
          </div>
          <div class="content">
            <p>Se ha registrado un nuevo cliente en el portal:</p>
            <div class="client-info">
              <p><strong>Nombre:</strong> ${clientName}</p>
              <p><strong>Email:</strong> ${clientEmail}</p>
            </div>
            <a href="${portalUrl}/admin/clients" class="button">Ver en el Panel Admin</a>
          </div>
          <div class="footer">
            <p>Portal JAI1 - Notificación Automática</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: adminEmail,
      subject: `Nuevo cliente registrado: ${clientName}`,
      html,
    });
  }
}
