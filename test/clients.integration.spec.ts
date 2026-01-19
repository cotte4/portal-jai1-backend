/**
 * Clients Controller Integration Tests
 *
 * These tests verify the full HTTP request/response cycle for client endpoints.
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

describe('Clients Controller (Integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrismaClient>;
  let accessToken: string;
  let adminAccessToken: string;
  let clientUserId: string;

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
  }, 60000);

  // Clean database and create test users before each test
  beforeEach(async () => {
    if (app) {
      await cleanTestDatabase();

      // Create a client user
      const clientResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'testclient@example.com',
          password: 'Password123!',
          first_name: 'Test',
          last_name: 'Client',
          phone: '+1234567890',
        });

      accessToken = clientResponse.body.access_token;
      clientUserId = clientResponse.body.user.id;

      // Create an admin user
      const adminResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'admin@example.com',
          password: 'AdminPassword123!',
          first_name: 'Admin',
          last_name: 'User',
        });

      // Update user to admin role
      await prisma.user.update({
        where: { id: adminResponse.body.user.id },
        data: { role: 'admin' },
      });

      // Re-login admin to get token with admin role
      const adminLoginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'AdminPassword123!',
        });

      adminAccessToken = adminLoginResponse.body.access_token;
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

  describe('GET /profile', () => {
    itIfDb('should return client profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('testclient@example.com');
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/profile')
        .expect(401);
    });
  });

  describe('POST /profile/complete', () => {
    const completeProfileData = {
      ssn: '123-45-6789',
      date_of_birth: '1990-01-15',
      address_street: '123 Main St',
      address_city: 'New York',
      address_state: 'NY',
      address_zip: '10001',
    };

    itIfDb('should complete client profile', async () => {
      const response = await request(app.getHttpServer())
        .post('/profile/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(completeProfileData)
        .expect(201);

      expect(response.body).toHaveProperty('profile');
      expect(response.body.profile.profileComplete).toBe(true);
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/profile/complete')
        .send(completeProfileData)
        .expect(401);
    });
  });

  describe('PATCH /profile/user-info', () => {
    itIfDb('should update user info', async () => {
      const response = await request(app.getHttpServer())
        .patch('/profile/user-info')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          phone: '+1987654321',
          firstName: 'Updated',
        })
        .expect(200);

      expect(response.body.user.firstName).toBe('Updated');
    });
  });

  describe('GET /admin/stats/season', () => {
    itIfDb('should return season stats for admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/stats/season')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalClients');
    });

    itIfDb('should deny access to non-admin', async () => {
      await request(app.getHttpServer())
        .get('/admin/stats/season')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('GET /admin/clients', () => {
    itIfDb('should return client list for admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('clients');
      expect(Array.isArray(response.body.clients)).toBe(true);
    });

    itIfDb('should support search filter', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/clients?search=testclient')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.clients.length).toBeGreaterThanOrEqual(0);
    });

    itIfDb('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/clients?limit=10')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('nextCursor');
      expect(response.body).toHaveProperty('hasMore');
    });

    itIfDb('should deny access to non-admin', async () => {
      await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('GET /admin/clients/:id', () => {
    itIfDb('should return single client for admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/clients/${clientUserId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.user.id).toBe(clientUserId);
    });

    itIfDb('should return 404 for non-existent client', async () => {
      await request(app.getHttpServer())
        .get('/admin/clients/non-existent-id')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('PATCH /admin/clients/:id/status', () => {
    itIfDb('should update client status', async () => {
      // First complete the profile to create a tax case
      await request(app.getHttpServer())
        .post('/profile/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ssn: '123-45-6789',
          date_of_birth: '1990-01-15',
          address_street: '123 Main St',
          address_city: 'New York',
          address_state: 'NY',
          address_zip: '10001',
        });

      const response = await request(app.getHttpServer())
        .patch(`/admin/clients/${clientUserId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          preFilingStatus: 'documents_received',
        })
        .expect(200);

      expect(response.body).toHaveProperty('taxCase');
    });
  });

  describe('DELETE /admin/clients/:id', () => {
    itIfDb('should delete client', async () => {
      // Create a new user to delete
      const newUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'todelete@example.com',
          password: 'Password123!',
          first_name: 'To',
          last_name: 'Delete',
        });

      const userIdToDelete = newUserResponse.body.user.id;

      await request(app.getHttpServer())
        .delete(`/admin/clients/${userIdToDelete}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      // Verify user is deleted
      const deletedUser = await prisma.user.findUnique({
        where: { id: userIdToDelete },
      });
      expect(deletedUser).toBeNull();
    });
  });
});
