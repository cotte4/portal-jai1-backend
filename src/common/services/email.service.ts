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
    // Use format "Name <email>" for better deliverability
    const emailFrom = this.configService.get<string>('EMAIL_FROM') || 'contacto@jai1taxes.com';
    this.fromEmail = emailFrom.includes('<') ? emailFrom : `JAI1 <${emailFrom}>`;

    // Log configuration on startup for debugging
    this.logger.log(`Email service initializing...`);
    this.logger.log(`EMAIL_FROM: ${this.fromEmail}`);
    this.logger.log(`RESEND_API_KEY: ${apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET'}`);

    if (apiKey && apiKey !== 're_your_resend_api_key') {
      this.resend = new Resend(apiKey);
      this.isConfigured = true;
      this.logger.log(`Email service configured successfully with Resend`);
    } else {
      this.isConfigured = false;
      this.logger.warn('Resend API key not configured. Emails will be logged only.');
    }
  }

  private async send(options: EmailOptions): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`[EMAIL NOT CONFIGURED] Would send to: ${options.to}`);
      this.logger.warn(`[EMAIL NOT CONFIGURED] Subject: ${options.subject}`);
      this.logger.warn(`[EMAIL NOT CONFIGURED] Set RESEND_API_KEY in .env to enable emails`);
      return false; // Return false so callers know email wasn't actually sent
    }

    try {
      this.logger.log(`Attempting to send email to ${options.to}...`);
      this.logger.log(`From address: ${this.fromEmail}`);
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });

      if (error) {
        this.logger.error(`Resend API error: ${JSON.stringify(error)}`);
        this.logger.error(`Status code: ${error.statusCode}, Message: ${error.message}`);
        return false;
      }

      this.logger.log(`Email sent successfully to ${options.to}: ${options.subject}`);
      this.logger.log(`Resend ID: ${data?.id}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${options.to}`);
      this.logger.error(`From address used: ${this.fromEmail}`);
      this.logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
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
            <a href="${portalUrl}/messages" class="button">Ver Conversación Completa</a>
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
   * Send password reset email
   */
  async sendPasswordResetEmail(
    to: string,
    firstName: string,
    resetToken: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

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
          .warning { background-color: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin: 15px 0; border-radius: 4px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Restablecer Contrasena</h1>
          </div>
          <div class="content">
            <p>Hola <strong>${firstName}</strong>,</p>
            <p>Recibimos una solicitud para restablecer la contrasena de tu cuenta en JAI1.</p>
            <p>Haz clic en el siguiente boton para crear una nueva contrasena:</p>
            <p style="text-align: center;">
              <a href="${resetLink}" class="button">Restablecer Contrasena</a>
            </p>
            <div class="warning">
              <strong>Importante:</strong> Este enlace expirara en 1 hora por seguridad.
            </div>
            <p>Si no solicitaste este cambio, puedes ignorar este correo. Tu contrasena actual seguira siendo la misma.</p>
          </div>
          <div class="footer">
            <p>El equipo JAI1</p>
            <p style="font-size: 10px; color: #999;">Si el boton no funciona, copia y pega este enlace en tu navegador: ${resetLink}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to,
      subject: 'Restablecer tu contrasena - JAI1',
      html,
    });
  }

  /**
   * Send custom notification email
   */
  async sendNotificationEmail(
    to: string,
    firstName: string,
    title: string,
    message: string,
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
          .message-box { background-color: white; border-left: 4px solid #1D345D; padding: 15px; margin: 15px 0; }
          .button { display: inline-block; background-color: #1D345D; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
          </div>
          <div class="content">
            <p>Hola <strong>${firstName}</strong>,</p>
            <div class="message-box">
              <p>${message}</p>
            </div>
            <a href="${portalUrl}" class="button">Ir al Portal</a>
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
      subject: title,
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
