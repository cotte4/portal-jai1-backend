import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters');
    }
    // Use first 32 bytes as key
    this.key = Buffer.from(encryptionKey.slice(0, 32), 'utf-8');
  }

  /**
   * Encrypts a string using AES-256-GCM
   * Returns: iv:authTag:encryptedData (base64 encoded)
   */
  encrypt(text: string): string {
    if (!text) return text;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  /**
   * Decrypts a string encrypted with encrypt()
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) return encryptedText;

    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        this.logger.warn('Invalid encrypted format: expected 3 parts separated by ":"', {
          partsCount: parts.length,
          textLength: encryptedText.length,
          hasSeparator: encryptedText.includes(':'),
        });
        // Not encrypted or invalid format, return as-is
        return encryptedText;
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed', {
        error: error.message,
        encryptedTextLength: encryptedText?.length,
        format: encryptedText?.includes(':') ? 'has_separator' : 'no_separator',
        partsCount: encryptedText?.split(':').length,
      });
      // If decryption fails, return original (might not be encrypted)
      return encryptedText;
    }
  }

  /**
   * Safe decrypt that returns null on failure instead of the encrypted text
   * Use this for credential reveals where we want to explicitly handle failures
   */
  safeDecrypt(encryptedText: string | null, fieldName?: string): string | null {
    if (!encryptedText) return null;

    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        this.logger.warn(`Safe decrypt: Invalid format for ${fieldName || 'field'}`, {
          partsCount: parts.length,
          textLength: encryptedText.length,
        });
        return null;
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error(`Safe decrypt failed for ${fieldName || 'field'}`, {
        error: error.message,
        encryptedTextLength: encryptedText.length,
      });
      return null;
    }
  }

  /**
   * Masks SSN for display: 123-45-6789 -> ***-**-6789
   */
  maskSSN(ssn: string): string | null {
    if (!ssn) return null;
    const decrypted = this.decrypt(ssn);
    if (decrypted.length >= 4) {
      return `***-**-${decrypted.slice(-4)}`;
    }
    return '***-**-****';
  }

  /**
   * Encrypts sensitive profile fields
   * Includes: SSN, address, bank numbers, TurboTax credentials, IRS/State credentials
   */
  encryptProfileData(data: {
    ssn?: string;
    addressStreet?: string;
    turbotaxEmail?: string;
    turbotaxPassword?: string;
    bankRoutingNumber?: string;
    bankAccountNumber?: string;
    irsUsername?: string;
    irsPassword?: string;
    stateUsername?: string;
    statePassword?: string;
  }): {
    ssn?: string;
    addressStreet?: string;
    turbotaxEmail?: string;
    turbotaxPassword?: string;
    bankRoutingNumber?: string;
    bankAccountNumber?: string;
    irsUsername?: string;
    irsPassword?: string;
    stateUsername?: string;
    statePassword?: string;
  } {
    return {
      ssn: data.ssn ? this.encrypt(data.ssn) : undefined,
      addressStreet: data.addressStreet ? this.encrypt(data.addressStreet) : undefined,
      turbotaxEmail: data.turbotaxEmail ? this.encrypt(data.turbotaxEmail) : undefined,
      turbotaxPassword: data.turbotaxPassword ? this.encrypt(data.turbotaxPassword) : undefined,
      bankRoutingNumber: data.bankRoutingNumber ? this.encrypt(data.bankRoutingNumber) : undefined,
      bankAccountNumber: data.bankAccountNumber ? this.encrypt(data.bankAccountNumber) : undefined,
      irsUsername: data.irsUsername ? this.encrypt(data.irsUsername) : undefined,
      irsPassword: data.irsPassword ? this.encrypt(data.irsPassword) : undefined,
      stateUsername: data.stateUsername ? this.encrypt(data.stateUsername) : undefined,
      statePassword: data.statePassword ? this.encrypt(data.statePassword) : undefined,
    };
  }

  /**
   * Decrypts sensitive profile fields
   * Includes: SSN, address, bank numbers, TurboTax credentials, IRS/State credentials
   */
  decryptProfileData(data: {
    ssn?: string;
    addressStreet?: string;
    turbotaxEmail?: string;
    turbotaxPassword?: string;
    bankRoutingNumber?: string;
    bankAccountNumber?: string;
    irsUsername?: string;
    irsPassword?: string;
    stateUsername?: string;
    statePassword?: string;
  }): {
    ssn?: string;
    addressStreet?: string;
    turbotaxEmail?: string;
    turbotaxPassword?: string;
    bankRoutingNumber?: string;
    bankAccountNumber?: string;
    irsUsername?: string;
    irsPassword?: string;
    stateUsername?: string;
    statePassword?: string;
  } {
    return {
      ssn: data.ssn ? this.decrypt(data.ssn) : undefined,
      addressStreet: data.addressStreet ? this.decrypt(data.addressStreet) : undefined,
      turbotaxEmail: data.turbotaxEmail ? this.decrypt(data.turbotaxEmail) : undefined,
      turbotaxPassword: data.turbotaxPassword ? this.decrypt(data.turbotaxPassword) : undefined,
      bankRoutingNumber: data.bankRoutingNumber ? this.decrypt(data.bankRoutingNumber) : undefined,
      bankAccountNumber: data.bankAccountNumber ? this.decrypt(data.bankAccountNumber) : undefined,
      irsUsername: data.irsUsername ? this.decrypt(data.irsUsername) : undefined,
      irsPassword: data.irsPassword ? this.decrypt(data.irsPassword) : undefined,
      stateUsername: data.stateUsername ? this.decrypt(data.stateUsername) : undefined,
      statePassword: data.statePassword ? this.decrypt(data.statePassword) : undefined,
    };
  }

  /**
   * Masks bank account number for display: 123456789 -> ****6789
   */
  maskBankAccount(accountNumber: string): string | null {
    if (!accountNumber) return null;
    const decrypted = this.decrypt(accountNumber);
    if (decrypted.length >= 4) {
      return `****${decrypted.slice(-4)}`;
    }
    return '****';
  }

  /**
   * Masks routing number for display: 123456789 -> ****6789
   */
  maskRoutingNumber(routingNumber: string): string | null {
    if (!routingNumber) return null;
    const decrypted = this.decrypt(routingNumber);
    if (decrypted.length >= 4) {
      return `****${decrypted.slice(-4)}`;
    }
    return '****';
  }

  /**
   * Masks email for display: john.doe@example.com -> jo****@example.com
   * Shows first 2 characters of local part, then **** and the full domain
   */
  maskEmail(email: string): string | null {
    if (!email) return null;
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return '****@****.***';
    const localPart = email.substring(0, atIndex);
    const domain = email.substring(atIndex);
    const visibleChars = Math.min(2, localPart.length);
    return `${localPart.substring(0, visibleChars)}****${domain}`;
  }
}
