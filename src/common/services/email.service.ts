import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { redactEmail } from '../utils/log-sanitizer';

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
      this.logger.warn(`[EMAIL NOT CONFIGURED] Would send to: ${redactEmail(options.to)}`);
      this.logger.warn(`[EMAIL NOT CONFIGURED] Subject: ${options.subject}`);
      this.logger.warn(`[EMAIL NOT CONFIGURED] Set RESEND_API_KEY in .env to enable emails`);
      return false; // Return false so callers know email wasn't actually sent
    }

    try {
      this.logger.log(`Attempting to send email to ${redactEmail(options.to)}...`);
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

      this.logger.log(`Email sent successfully to ${redactEmail(options.to)}: ${options.subject}`);
      this.logger.log(`Resend ID: ${data?.id}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${redactEmail(options.to)}`);
      this.logger.error(`From address used: ${this.fromEmail}`);
      this.logger.error(`Error details: ${JSON.stringify(error, null, 2)}`);
      return false;
    }
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
}
