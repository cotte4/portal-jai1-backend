/**
 * Auth Controller Integration Tests
 *
 * These tests verify the full HTTP request/response cycle for auth endpoints.
 * They use a real PostgreSQL database (Docker) but mock external services.
 *
 * Prerequisites:
 * 1. Start Docker: docker-compose -f docker-compose.test.yml up -d
 * 2. Push schema: DATABASE_URL=postgresql://test_user:test_password@localhost:5433/portal_jai1_test npx prisma db push
 *
 * Run with: npm run test:integration
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app-factory';
import {
  cleanTestDatabase,
  disconnectTestDatabase,
  getPrismaClient,
  isTestDatabaseAvailable,
} from './integration-setup';

describe('Auth Controller (Integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrismaClient>;

  // Check if database is available before running tests
  beforeAll(async () => {
    const dbAvailable = await isTestDatabaseAvailable();
    if (!dbAvailable) {
      console.warn(
        '\n⚠️  Test database not available. Skipping integration tests.\n' +
          '   To run integration tests:\n' +
          '   1. Start Docker: docker-compose -f docker-compose.test.yml up -d\n' +
          '   2. Push schema: npm run test:db:push\n',
      );
      return;
    }

    // Create the test app
    app = await createTestApp();
    prisma = getPrismaClient();
  }, 60000); // 60s timeout for app initialization

  // Clean database before each test
  beforeEach(async () => {
    if (app) {
      await cleanTestDatabase();
    }
  });

  // Cleanup after all tests
  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectTestDatabase();
  });

  // Skip tests if database not available
  const itIfDb = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app) {
        console.log(`  ⏭️  Skipped: ${name} (no database)`);
        return;
      }
      await fn();
    });
  };

  describe('POST /auth/register', () => {
    const validRegisterData = {
      email: 'newuser@example.com',
      password: 'SecurePassword123!',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1234567890',
    };

    itIfDb('should register a new user successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validRegisterData)
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('expires_in');

      // Verify user data
      expect(response.body.user.email).toBe(validRegisterData.email);
      expect(response.body.user.first_name).toBe(validRegisterData.first_name);
      expect(response.body.user.last_name).toBe(validRegisterData.last_name);
      expect(response.body.user.role).toBe('client');

      // Verify password is not returned
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body.user).not.toHaveProperty('passwordHash');

      // Verify user exists in database
      const dbUser = await prisma.user.findUnique({
        where: { email: validRegisterData.email },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.firstName).toBe(validRegisterData.first_name);
    });

    itIfDb('should return 409 for duplicate email', async () => {
      // First registration
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(validRegisterData)
        .expect(201);

      // Second registration with same email
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validRegisterData)
        .expect(409);

      expect(response.body.message).toBe('Email already registered');
    });

    itIfDb('should return 400 for invalid email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          ...validRegisterData,
          email: 'not-an-email',
        })
        .expect(400);

      expect(response.body.message.some((m: string) => m.includes('email'))).toBe(true);
    });

    itIfDb('should return 400 for missing required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          // Missing password, first_name, last_name
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    itIfDb('should register user with valid referral code', async () => {
      // First, create a user who will be the referrer
      const referrerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'referrer@example.com',
          password: 'Password123!',
          first_name: 'Jane',
          last_name: 'Smith',
        })
        .expect(201);

      // Create a referral code for the referrer
      // (In real app, this happens when profile is complete)
      await prisma.user.update({
        where: { id: referrerResponse.body.user.id },
        data: {
          referralCode: 'JAN1234',
          referralCodeCreatedAt: new Date(),
        },
      });

      // Register new user with referral code
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          ...validRegisterData,
          email: 'referred@example.com',
          referral_code: 'JAN1234',
        })
        .expect(201);

      // Verify the referred user was created
      expect(response.body.user.email).toBe('referred@example.com');

      // Verify referral record was created
      const referral = await prisma.referral.findFirst({
        where: {
          referredUserId: response.body.user.id,
        },
      });
      expect(referral).not.toBeNull();
      expect(referral?.referralCode).toBe('JAN1234');
    });

    itIfDb('should return 400 for invalid referral code', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          ...validRegisterData,
          referral_code: 'INVALID123',
        })
        .expect(400);

      expect(response.body.message).toBe('Invalid referral code');
    });
  });

  describe('POST /auth/login', () => {
    const userData = {
      email: 'logintest@example.com',
      password: 'TestPassword123!',
      first_name: 'Login',
      last_name: 'Test',
    };

    beforeEach(async () => {
      if (app) {
        // Create a user for login tests
        await request(app.getHttpServer())
          .post('/auth/register')
          .send(userData);
      }
    });

    itIfDb('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body.user.email).toBe(userData.email);
    });

    itIfDb('should return 401 for wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    itIfDb('should return 401 for non-existent email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    itIfDb('should return 401 for deactivated account', async () => {
      // Deactivate the user
      await prisma.user.update({
        where: { email: userData.email },
        data: { isActive: false },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(401);

      expect(response.body.message).toBe('Account is deactivated');
    });
  });

  describe('POST /auth/logout', () => {
    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(401);
    });

    itIfDb('should logout successfully with valid token', async () => {
      // Register and get tokens
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'logout@example.com',
          password: 'Password123!',
          first_name: 'Logout',
          last_name: 'Test',
        });

      const accessToken = registerResponse.body.access_token;

      // Logout
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.message).toBe('Logged out successfully');
    });
  });

  describe('POST /auth/refresh', () => {
    itIfDb('should refresh tokens with valid refresh token', async () => {
      // Register and get tokens
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'refresh@example.com',
          password: 'Password123!',
          first_name: 'Refresh',
          last_name: 'Test',
        });

      const refreshToken = registerResponse.body.refresh_token;

      // Refresh tokens
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('user');

      // New tokens should be different (rotation)
      expect(response.body.refresh_token).not.toBe(refreshToken);
    });

    itIfDb('should return 401 for invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'invalid-token' })
        .expect(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    itIfDb('should return success for existing email', async () => {
      // Create a user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'forgot@example.com',
          password: 'Password123!',
          first_name: 'Forgot',
          last_name: 'Test',
        });

      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'forgot@example.com' })
        .expect(200);

      // Same message for security (doesn't reveal if email exists)
      expect(response.body.message).toBe(
        'If the email exists, a reset link has been sent',
      );

      // Verify reset token was set in database
      const user = await prisma.user.findUnique({
        where: { email: 'forgot@example.com' },
      });
      expect(user?.resetToken).not.toBeNull();
    });

    itIfDb('should return success for non-existent email (security)', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      // Same message to prevent email enumeration
      expect(response.body.message).toBe(
        'If the email exists, a reset link has been sent',
      );
    });
  });

  describe('POST /auth/change-password', () => {
    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({
          current_password: 'OldPassword123!',
          new_password: 'NewPassword123!',
        })
        .expect(401);
    });

    itIfDb('should change password with valid current password', async () => {
      // Register
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'change@example.com',
          password: 'OldPassword123!',
          first_name: 'Change',
          last_name: 'Test',
        });

      const accessToken = registerResponse.body.access_token;

      // Change password
      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          current_password: 'OldPassword123!',
          new_password: 'NewPassword123!',
        })
        .expect(200);

      expect(response.body.message).toBe('Password has been changed successfully');

      // Verify can login with new password
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'change@example.com',
          password: 'NewPassword123!',
        })
        .expect(200);
    });

    itIfDb('should return 400 for incorrect current password', async () => {
      // Register
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'wrongcurrent@example.com',
          password: 'CorrectPassword123!',
          first_name: 'Wrong',
          last_name: 'Current',
        });

      const accessToken = registerResponse.body.access_token;

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          current_password: 'WrongPassword123!',
          new_password: 'NewPassword123!',
        })
        .expect(400);

      expect(response.body.message).toBe('Current password is incorrect');
    });
  });
});
