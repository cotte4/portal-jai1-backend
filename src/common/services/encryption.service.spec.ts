import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

/**
 * Encryption Service Unit Tests
 *
 * Tests the EncryptionService's encryption, decryption, and masking methods.
 * Critical for ensuring sensitive client data (SSN, bank accounts) is properly handled.
 */

describe('EncryptionService', () => {
  let service: EncryptionService;

  const validEncryptionKey = 'this-is-a-32-character-test-key!'; // 32 chars

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(validEncryptionKey),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw error if ENCRYPTION_KEY is too short', async () => {
      const mockConfigService = {
        get: jest.fn().mockReturnValue('short-key'),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            EncryptionService,
            { provide: ConfigService, useValue: mockConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('ENCRYPTION_KEY must be at least 32 characters');
    });

    it('should throw error if ENCRYPTION_KEY is undefined', async () => {
      const mockConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            EncryptionService,
            { provide: ConfigService, useValue: mockConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('ENCRYPTION_KEY must be at least 32 characters');
    });
  });

  describe('encrypt', () => {
    it('should encrypt a string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':'); // Format: iv:authTag:encryptedData
    });

    it('should return different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'Test String';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should return encrypted string in correct format', () => {
      const encrypted = service.encrypt('test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      // Each part should be base64 encoded
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('should return empty string as-is', () => {
      expect(service.encrypt('')).toBe('');
    });

    it('should return null/undefined as-is', () => {
      expect(service.encrypt(null as any)).toBe(null);
      expect(service.encrypt(undefined as any)).toBe(undefined);
    });

    it('should encrypt special characters', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const encrypted = service.encrypt(specialChars);

      expect(encrypted).not.toBe(specialChars);
      expect(service.decrypt(encrypted)).toBe(specialChars);
    });

    it('should encrypt unicode characters', () => {
      const unicode = '你好世界 🌍 مرحبا';
      const encrypted = service.encrypt(unicode);

      expect(encrypted).not.toBe(unicode);
      expect(service.decrypt(encrypted)).toBe(unicode);
    });

    it('should encrypt long strings', () => {
      const longString = 'a'.repeat(10000);
      const encrypted = service.encrypt(longString);

      expect(encrypted).not.toBe(longString);
      expect(service.decrypt(encrypted)).toBe(longString);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted string correctly', () => {
      const plaintext = 'Secret Message 123';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should return original if format is invalid (not 3 parts)', () => {
      const invalid = 'not:valid:format:extra';
      expect(service.decrypt(invalid)).toBe(invalid);

      const tooFew = 'only:two';
      expect(service.decrypt(tooFew)).toBe(tooFew);
    });

    it('should return original if not encrypted (no colons)', () => {
      const plaintext = 'just plain text';
      expect(service.decrypt(plaintext)).toBe(plaintext);
    });

    it('should return empty string as-is', () => {
      expect(service.decrypt('')).toBe('');
    });

    it('should return null/undefined as-is', () => {
      expect(service.decrypt(null as any)).toBe(null);
      expect(service.decrypt(undefined as any)).toBe(undefined);
    });

    it('should return original on decryption failure (corrupted data)', () => {
      const corrupted = 'abc:def:ghi'; // Invalid base64 that looks like encrypted
      expect(service.decrypt(corrupted)).toBe(corrupted);
    });

    it('should handle tampered ciphertext gracefully', () => {
      const encrypted = service.encrypt('test');
      const parts = encrypted.split(':');
      // Tamper with the encrypted data
      parts[2] = 'tampered' + parts[2];
      const tampered = parts.join(':');

      // Should return the tampered string (not throw)
      expect(service.decrypt(tampered)).toBe(tampered);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('should round-trip SSN correctly', () => {
      const ssn = '123-45-6789';
      expect(service.decrypt(service.encrypt(ssn))).toBe(ssn);
    });

    it('should round-trip bank account number correctly', () => {
      const accountNumber = '9876543210';
      expect(service.decrypt(service.encrypt(accountNumber))).toBe(accountNumber);
    });

    it('should round-trip routing number correctly', () => {
      const routingNumber = '021000021';
      expect(service.decrypt(service.encrypt(routingNumber))).toBe(routingNumber);
    });

    it('should round-trip address correctly', () => {
      const address = '123 Main St, Apt 4B, New York, NY 10001';
      expect(service.decrypt(service.encrypt(address))).toBe(address);
    });

    it('should round-trip email correctly', () => {
      const email = 'user@example.com';
      expect(service.decrypt(service.encrypt(email))).toBe(email);
    });

    it('should round-trip password correctly', () => {
      const password = 'MySecure$Password123!';
      expect(service.decrypt(service.encrypt(password))).toBe(password);
    });
  });

  describe('maskSSN', () => {
    it('should mask decrypted SSN showing last 4 digits', () => {
      const ssn = '123-45-6789';
      const encrypted = service.encrypt(ssn);
      const masked = service.maskSSN(encrypted);

      expect(masked).toBe('***-**-6789');
    });

    it('should mask SSN without dashes', () => {
      const ssn = '123456789';
      const encrypted = service.encrypt(ssn);
      const masked = service.maskSSN(encrypted);

      expect(masked).toBe('***-**-6789');
    });

    it('should handle short SSN gracefully', () => {
      const shortSsn = '123';
      const encrypted = service.encrypt(shortSsn);
      const masked = service.maskSSN(encrypted);

      expect(masked).toBe('***-**-****');
    });

    it('should return null for null input', () => {
      expect(service.maskSSN(null as any)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.maskSSN('')).toBeNull();
    });

    it('should handle unencrypted SSN (returns masked plaintext)', () => {
      // If SSN is not encrypted, decrypt returns as-is
      const plainSsn = '123-45-6789';
      const masked = service.maskSSN(plainSsn);

      expect(masked).toBe('***-**-6789');
    });
  });

  describe('maskBankAccount', () => {
    it('should mask bank account showing last 4 digits', () => {
      const account = '123456789012';
      const encrypted = service.encrypt(account);
      const masked = service.maskBankAccount(encrypted);

      expect(masked).toBe('****9012');
    });

    it('should handle short account number', () => {
      const shortAccount = '123';
      const encrypted = service.encrypt(shortAccount);
      const masked = service.maskBankAccount(encrypted);

      expect(masked).toBe('****');
    });

    it('should return null for null input', () => {
      expect(service.maskBankAccount(null as any)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.maskBankAccount('')).toBeNull();
    });
  });

  describe('maskRoutingNumber', () => {
    it('should mask routing number showing last 4 digits', () => {
      const routing = '021000021';
      const encrypted = service.encrypt(routing);
      const masked = service.maskRoutingNumber(encrypted);

      expect(masked).toBe('****0021');
    });

    it('should handle short routing number', () => {
      const shortRouting = '12';
      const encrypted = service.encrypt(shortRouting);
      const masked = service.maskRoutingNumber(encrypted);

      expect(masked).toBe('****');
    });

    it('should return null for null input', () => {
      expect(service.maskRoutingNumber(null as any)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.maskRoutingNumber('')).toBeNull();
    });
  });

  describe('encryptProfileData', () => {
    it('should encrypt all sensitive profile fields', () => {
      const data = {
        ssn: '123-45-6789',
        addressStreet: '123 Main St',
        turbotaxEmail: 'user@turbotax.com',
        turbotaxPassword: 'password123',
        bankRoutingNumber: '021000021',
        bankAccountNumber: '123456789',
        irsUsername: 'irsuser',
        irsPassword: 'irspass',
        stateUsername: 'stateuser',
        statePassword: 'statepass',
      };

      const encrypted = service.encryptProfileData(data);

      // All fields should be encrypted (different from original)
      expect(encrypted.ssn).not.toBe(data.ssn);
      expect(encrypted.addressStreet).not.toBe(data.addressStreet);
      expect(encrypted.turbotaxEmail).not.toBe(data.turbotaxEmail);
      expect(encrypted.turbotaxPassword).not.toBe(data.turbotaxPassword);
      expect(encrypted.bankRoutingNumber).not.toBe(data.bankRoutingNumber);
      expect(encrypted.bankAccountNumber).not.toBe(data.bankAccountNumber);
      expect(encrypted.irsUsername).not.toBe(data.irsUsername);
      expect(encrypted.irsPassword).not.toBe(data.irsPassword);
      expect(encrypted.stateUsername).not.toBe(data.stateUsername);
      expect(encrypted.statePassword).not.toBe(data.statePassword);

      // All should contain encrypted format
      Object.values(encrypted).forEach((value) => {
        if (value) {
          expect(value.split(':')).toHaveLength(3);
        }
      });
    });

    it('should handle partial data (only some fields provided)', () => {
      const data = {
        ssn: '123-45-6789',
        addressStreet: '123 Main St',
      };

      const encrypted = service.encryptProfileData(data);

      expect(encrypted.ssn).toBeDefined();
      expect(encrypted.addressStreet).toBeDefined();
      expect(encrypted.turbotaxEmail).toBeUndefined();
      expect(encrypted.bankAccountNumber).toBeUndefined();
    });

    it('should skip undefined fields', () => {
      const data = {
        ssn: undefined,
        addressStreet: '123 Main St',
      };

      const encrypted = service.encryptProfileData(data);

      expect(encrypted.ssn).toBeUndefined();
      expect(encrypted.addressStreet).toBeDefined();
    });
  });

  describe('decryptProfileData', () => {
    it('should decrypt all sensitive profile fields', () => {
      const originalData = {
        ssn: '123-45-6789',
        addressStreet: '123 Main St',
        turbotaxEmail: 'user@turbotax.com',
        turbotaxPassword: 'password123',
        bankRoutingNumber: '021000021',
        bankAccountNumber: '123456789',
        irsUsername: 'irsuser',
        irsPassword: 'irspass',
        stateUsername: 'stateuser',
        statePassword: 'statepass',
      };

      const encrypted = service.encryptProfileData(originalData);
      const decrypted = service.decryptProfileData(encrypted);

      expect(decrypted).toEqual(originalData);
    });

    it('should handle partial data', () => {
      const originalData = {
        ssn: '123-45-6789',
        addressStreet: '123 Main St',
      };

      const encrypted = service.encryptProfileData(originalData);
      const decrypted = service.decryptProfileData(encrypted);

      expect(decrypted.ssn).toBe(originalData.ssn);
      expect(decrypted.addressStreet).toBe(originalData.addressStreet);
      expect(decrypted.turbotaxEmail).toBeUndefined();
    });

    it('should skip undefined fields', () => {
      const data = {
        ssn: undefined,
        addressStreet: service.encrypt('123 Main St'),
      };

      const decrypted = service.decryptProfileData(data);

      expect(decrypted.ssn).toBeUndefined();
      expect(decrypted.addressStreet).toBe('123 Main St');
    });
  });

  describe('encryptProfileData/decryptProfileData round-trip', () => {
    it('should round-trip full profile data correctly', () => {
      const originalData = {
        ssn: '999-88-7777',
        addressStreet: '456 Oak Avenue, Suite 100',
        turbotaxEmail: 'tax.user@example.com',
        turbotaxPassword: 'TurboTax$ecure!',
        bankRoutingNumber: '011401533',
        bankAccountNumber: '1234567890123',
        irsUsername: 'irs_johndoe',
        irsPassword: 'IRS_Password_123',
        stateUsername: 'state_johndoe',
        statePassword: 'State_Password_456',
      };

      const encrypted = service.encryptProfileData(originalData);
      const decrypted = service.decryptProfileData(encrypted);

      expect(decrypted).toEqual(originalData);
    });
  });
});
