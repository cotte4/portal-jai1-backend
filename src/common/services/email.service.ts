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

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Restablecer Contrasena - JAI1</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!-- Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);border-radius:16px 16px 0 0;padding:40px 48px;text-align:center;">
              <div style="margin-bottom:28px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:6px;text-transform:uppercase;">JAI1</span><span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:400;color:rgba(255,255,255,0.45);letter-spacing:6px;text-transform:uppercase;margin-left:4px;">TAXES</span>
              </div>
              <div style="width:40px;height:1px;background:rgba(255,255,255,0.2);margin:0 auto 24px;"></div>
              <h1 style="margin:0;font-size:23px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Restablecer Contrasena</h1>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;">Solicitud de cambio de acceso</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px 48px;">
              <p style="margin:0 0 8px;font-size:16px;color:#1D345D;font-weight:600;">Hola, <span style="color:#B21B43;">${firstName}</span></p>
              <p style="margin:0 0 24px;font-size:15px;color:#4a5568;line-height:1.6;">Recibimos una solicitud para restablecer la contrasena de tu cuenta. Si fuiste tu, haz clic en el boton a continuacion para crear una nueva contrasena.</p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);">
                    <a href="${resetLink}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;letter-spacing:0.3px;">Restablecer Contrasena</a>
                  </td>
                </tr>
              </table>

              <!-- Notice box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:#fdf2f5;border-left:3px solid #B21B43;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
                    <p style="margin:0;font-size:13px;color:#7a2035;line-height:1.5;"><strong style="color:#B21B43;">&#9201; Expira en 1 hora.</strong> Por seguridad, este enlace dejara de ser valido pasado ese tiempo.</p>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#718096;line-height:1.6;">Si no solicitaste este cambio, puedes ignorar este correo sin problema. Tu contrasena actual permanecera sin cambios.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fb;border-radius:0 0 16px 16px;padding:24px 48px;border-top:1px solid #e8ecf0;">
              <p style="margin:0 0 8px;font-size:12px;color:#a0aec0;text-align:center;">Si el boton no funciona, copia y pega este enlace en tu navegador:</p>
              <p style="margin:0 0 16px;font-size:11px;color:#718096;text-align:center;word-break:break-all;">${resetLink}</p>
              <hr style="border:none;border-top:1px solid #e8ecf0;margin:16px 0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center;">© 2025 JAI1 Taxes · Todos los derechos reservados</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return this.send({
      to,
      subject: 'Restablecer tu contrasena - JAI1',
      html,
    });
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(
    to: string,
    firstName: string,
    verificationToken: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifica tu Email - JAI1</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!-- Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);border-radius:16px 16px 0 0;padding:40px 48px;text-align:center;">
              <div style="margin-bottom:28px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:6px;text-transform:uppercase;">JAI1</span><span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:400;color:rgba(255,255,255,0.45);letter-spacing:6px;text-transform:uppercase;margin-left:4px;">TAXES</span>
              </div>
              <div style="width:40px;height:1px;background:rgba(255,255,255,0.2);margin:0 auto 24px;"></div>
              <h1 style="margin:0;font-size:23px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Verifica tu Email</h1>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;">Un paso mas para activar tu cuenta</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px 48px;">
              <p style="margin:0 0 8px;font-size:16px;color:#1D345D;font-weight:600;">Bienvenido/a, <span style="color:#B21B43;">${firstName}</span></p>
              <p style="margin:0 0 24px;font-size:15px;color:#4a5568;line-height:1.6;">Gracias por registrarte en JAI1. Para completar tu registro y comenzar a usar el portal, necesitamos verificar tu direccion de email.</p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);">
                    <a href="${verificationLink}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;letter-spacing:0.3px;">Verificar mi Email</a>
                  </td>
                </tr>
              </table>

              <!-- Notice box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:#fdf2f5;border-left:3px solid #B21B43;border-radius:0 8px 8px 0;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#7a2035;line-height:1.5;"><strong style="color:#B21B43;">&#9201; Expira en 24 horas.</strong> Este enlace de verificacion es valido por un dia.</p>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#718096;line-height:1.6;">Si no creaste una cuenta en JAI1, puedes ignorar este correo con total tranquilidad.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fb;border-radius:0 0 16px 16px;padding:24px 48px;border-top:1px solid #e8ecf0;">
              <p style="margin:0 0 8px;font-size:12px;color:#a0aec0;text-align:center;">Si el boton no funciona, copia y pega este enlace en tu navegador:</p>
              <p style="margin:0 0 16px;font-size:11px;color:#718096;text-align:center;word-break:break-all;">${verificationLink}</p>
              <hr style="border:none;border-top:1px solid #e8ecf0;margin:16px 0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center;">© 2025 JAI1 Taxes · Todos los derechos reservados</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return this.send({
      to,
      subject: 'Verifica tu email - JAI1',
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

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - JAI1</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!-- Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);border-radius:16px 16px 0 0;padding:40px 48px;text-align:center;">
              <div style="margin-bottom:28px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:6px;text-transform:uppercase;">JAI1</span><span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:400;color:rgba(255,255,255,0.45);letter-spacing:6px;text-transform:uppercase;margin-left:4px;">TAXES</span>
              </div>
              <div style="width:40px;height:1px;background:rgba(255,255,255,0.2);margin:0 auto 24px;"></div>
              <h1 style="margin:0;font-size:23px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">${title}</h1>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.6);font-family:Arial,sans-serif;">Notificacion de tu cuenta</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px 48px;">
              <p style="margin:0 0 20px;font-size:16px;color:#1D345D;font-weight:600;">Hola, <span style="color:#B21B43;">${firstName}</span></p>

              <!-- Message box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#f8f9fb;border-radius:12px;border:1px solid #e8ecf0;padding:20px 24px;">
                    <p style="margin:0;font-size:15px;color:#2d3748;line-height:1.7;">${message}</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#B21B43 0%,#1D345D 100%);">
                    <a href="${portalUrl}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;letter-spacing:0.3px;">Ir al Portal</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fb;border-radius:0 0 16px 16px;padding:24px 48px;border-top:1px solid #e8ecf0;">
              <p style="margin:0 0 6px;font-size:13px;color:#718096;text-align:center;font-weight:500;">El equipo de JAI1 Taxes</p>
              <hr style="border:none;border-top:1px solid #e8ecf0;margin:16px 0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center;">© 2025 JAI1 Taxes · Todos los derechos reservados</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return this.send({
      to,
      subject: title,
      html,
    });
  }
}
