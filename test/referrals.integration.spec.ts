/**
 * Referrals Controller Integration Tests
 *
 * These tests verify the full HTTP request/response cycle for referral endpoints.
 * They use a real PostgreSQL database (Docker).
 *
 * Prerequisites:
 * 1. Start Docker: docker-compose -f docker-compose.test.yml up -d
 * 2. Push schema: npm run test:db:push
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

describe('Referrals Controller (Integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrismaClient>;
  let referrerAccessToken: string;
  let referrerUserId: string;
  let referrerCode: string;
  let adminAccessToken: string;

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

    app = await createTestApp();
    prisma = getPrismaClient();
  }, 60000);

  beforeEach(async () => {
    if (app) {
      await cleanTestDatabase();

      // Create a referrer user with completed profile (to have referral code)
      const referrerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'referrer@example.com',
          password: 'Password123!',
          first_name: 'Referrer',
          last_name: 'User',
        });

      referrerAccessToken = referrerResponse.body.access_token;
      referrerUserId = referrerResponse.body.user.id;

      // Complete profile to trigger referral code generation
      await request(app.getHttpServer())
        .post('/profile/complete')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .send({
          ssn: '111-22-3333',
          date_of_birth: '1985-06-15',
          address_street: '456 Referrer St',
          address_city: 'Boston',
          address_state: 'MA',
          address_zip: '02101',
        });

      // Generate referral code manually if not auto-generated
      referrerCode = 'REF' + Math.random().toString(36).substring(2, 6).toUpperCase();
      await prisma.user.update({
        where: { id: referrerUserId },
        data: {
          referralCode: referrerCode,
          referralCodeCreatedAt: new Date(),
        },
      });

      // Create admin user
      const adminResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'refadmin@example.com',
          password: 'AdminPassword123!',
          first_name: 'Ref',
          last_name: 'Admin',
        });

      await prisma.user.update({
        where: { id: adminResponse.body.user.id },
        data: { role: 'admin' },
      });

      const adminLoginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'refadmin@example.com',
          password: 'AdminPassword123!',
        });

      adminAccessToken = adminLoginResponse.body.access_token;
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectTestDatabase();
  });

  const itIfDb = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app) {
        console.log(`  ⏭️  Skipped: ${name} (no database)`);
        return;
      }
      await fn();
    });
  };

  describe('GET /referrals/validate/:code', () => {
    itIfDb('should validate a valid referral code', async () => {
      const response = await request(app.getHttpServer())
        .get(`/referrals/validate/${referrerCode}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.referrerId).toBe(referrerUserId);
    });

    itIfDb('should return invalid for non-existent code', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/validate/INVALID123')
        .expect(200);

      expect(response.body.valid).toBe(false);
    });

    itIfDb('should be accessible without authentication', async () => {
      await request(app.getHttpServer())
        .get(`/referrals/validate/${referrerCode}`)
        .expect(200);
    });
  });

  describe('POST /referrals/apply-code', () => {
    itIfDb('should apply referral code to new user', async () => {
      // Register new user without referral code
      const newUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'newreferred@example.com',
          password: 'Password123!',
          first_name: 'New',
          last_name: 'Referred',
        });

      const newUserToken = newUserResponse.body.access_token;

      // Apply referral code
      const response = await request(app.getHttpServer())
        .post('/referrals/apply-code')
        .set('Authorization', `Bearer ${newUserToken}`)
        .send({ code: referrerCode })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.referralCode).toBe(referrerCode);
    });

    itIfDb('should reject invalid referral code', async () => {
      // Register new user
      const newUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalidref@example.com',
          password: 'Password123!',
          first_name: 'Invalid',
          last_name: 'Ref',
        });

      await request(app.getHttpServer())
        .post('/referrals/apply-code')
        .set('Authorization', `Bearer ${newUserResponse.body.access_token}`)
        .send({ code: 'INVALID' })
        .expect(400);
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/referrals/apply-code')
        .send({ code: referrerCode })
        .expect(401);
    });
  });

  describe('GET /referrals/my-code', () => {
    itIfDb('should return user referral code', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/my-code')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('code');
      expect(response.body.code).toBe(referrerCode);
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/referrals/my-code')
        .expect(401);
    });
  });

  describe('GET /referrals/my-referrals', () => {
    itIfDb('should return referrals made by user', async () => {
      // Create a referred user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'myreferral@example.com',
          password: 'Password123!',
          first_name: 'My',
          last_name: 'Referral',
          referral_code: referrerCode,
        });

      const response = await request(app.getHttpServer())
        .get('/referrals/my-referrals')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    itIfDb('should return empty array if no referrals', async () => {
      // Create user without any referrals
      const newUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'noreferrals@example.com',
          password: 'Password123!',
          first_name: 'No',
          last_name: 'Referrals',
        });

      const response = await request(app.getHttpServer())
        .get('/referrals/my-referrals')
        .set('Authorization', `Bearer ${newUserResponse.body.access_token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /referrals/leaderboard', () => {
    itIfDb('should return leaderboard', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/leaderboard')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    itIfDb('should respect limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/leaderboard?limit=5')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(200);

      expect(response.body.length).toBeLessThanOrEqual(5);
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/referrals/leaderboard')
        .expect(401);
    });
  });

  describe('GET /referrals/admin', () => {
    itIfDb('should return all referrals for admin', async () => {
      // Create some referrals
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'adminref1@example.com',
          password: 'Password123!',
          first_name: 'Admin',
          last_name: 'Ref1',
          referral_code: referrerCode,
        });

      const response = await request(app.getHttpServer())
        .get('/referrals/admin')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('referrals');
      expect(Array.isArray(response.body.referrals)).toBe(true);
    });

    itIfDb('should support filtering by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/admin?status=pending')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('referrals');
    });

    itIfDb('should deny access to non-admin', async () => {
      await request(app.getHttpServer())
        .get('/referrals/admin')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(403);
    });
  });

  describe('GET /referrals/admin/stats', () => {
    itIfDb('should return referral stats for admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/referrals/admin/stats')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalReferrals');
    });

    itIfDb('should deny access to non-admin', async () => {
      await request(app.getHttpServer())
        .get('/referrals/admin/stats')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .expect(403);
    });
  });

  describe('PATCH /referrals/admin/:id/status', () => {
    itIfDb('should update referral status', async () => {
      // Create a referral
      const newUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'updatestatus@example.com',
          password: 'Password123!',
          first_name: 'Update',
          last_name: 'Status',
          referral_code: referrerCode,
        });

      // Find the referral
      const referral = await prisma.referral.findFirst({
        where: { referredUserId: newUserResponse.body.user.id },
      });

      const response = await request(app.getHttpServer())
        .patch(`/referrals/admin/${referral?.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'completed' })
        .expect(200);

      expect(response.body.status).toBe('completed');
    });

    itIfDb('should deny access to non-admin', async () => {
      await request(app.getHttpServer())
        .patch('/referrals/admin/some-id/status')
        .set('Authorization', `Bearer ${referrerAccessToken}`)
        .send({ status: 'completed' })
        .expect(403);
    });
  });
});
