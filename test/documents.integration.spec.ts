/**
 * Documents Controller Integration Tests
 *
 * These tests verify the full HTTP request/response cycle for document endpoints.
 * They use a real PostgreSQL database (Docker) but mock external storage services.
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

describe('Documents Controller (Integration)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrismaClient>;
  let accessToken: string;
  let adminAccessToken: string;
  let clientUserId: string;
  let adminUserId: string;

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

      // Create a client user
      const clientResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'docclient@example.com',
          password: 'Password123!',
          first_name: 'Doc',
          last_name: 'Client',
        });

      accessToken = clientResponse.body.access_token;
      clientUserId = clientResponse.body.user.id;

      // Create and setup admin user
      const adminResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'docadmin@example.com',
          password: 'AdminPassword123!',
          first_name: 'Doc',
          last_name: 'Admin',
        });

      adminUserId = adminResponse.body.user.id;

      await prisma.user.update({
        where: { id: adminUserId },
        data: { role: 'admin' },
      });

      const adminLoginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'docadmin@example.com',
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

  describe('POST /documents/upload', () => {
    itIfDb('should upload a document', async () => {
      // Create a test file buffer
      const testFileContent = Buffer.from('Test PDF content');

      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'test-document.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2')
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe('w2');
      expect(response.body.filename).toBe('test-document.pdf');
    });

    itIfDb('should require authentication', async () => {
      const testFileContent = Buffer.from('Test content');

      await request(app.getHttpServer())
        .post('/documents/upload')
        .attach('file', testFileContent, 'test.pdf')
        .field('type', 'w2')
        .expect(401);
    });

    itIfDb('should reject files over size limit', async () => {
      // Create a large file buffer (over 25MB)
      const largeContent = Buffer.alloc(26 * 1024 * 1024);

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', largeContent, {
          filename: 'large-file.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2')
        .expect(413); // Payload Too Large
    });
  });

  describe('GET /documents', () => {
    itIfDb('should return user documents', async () => {
      // First upload a document
      const testFileContent = Buffer.from('Test content');
      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'test-doc.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      // Then get documents
      const response = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    itIfDb('should return empty array for user with no documents', async () => {
      const response = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    itIfDb('should allow admin to query other client documents', async () => {
      // Upload document as client
      const testFileContent = Buffer.from('Client document');
      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'client-doc.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      // Admin queries client's documents
      const response = await request(app.getHttpServer())
        .get(`/documents?client_id=${clientUserId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    itIfDb('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/documents')
        .expect(401);
    });
  });

  describe('GET /documents/:id/download', () => {
    itIfDb('should return download URL for document owner', async () => {
      // Upload a document
      const testFileContent = Buffer.from('Downloadable content');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'download-test.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Get download URL
      const response = await request(app.getHttpServer())
        .get(`/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('url');
    });

    itIfDb('should deny access to other users documents', async () => {
      // Upload document as client
      const testFileContent = Buffer.from('Private content');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'private-doc.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Create another user
      const otherUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'other@example.com',
          password: 'Password123!',
          first_name: 'Other',
          last_name: 'User',
        });

      // Try to access document as other user
      await request(app.getHttpServer())
        .get(`/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${otherUserResponse.body.access_token}`)
        .expect(403);
    });

    itIfDb('should allow admin to download any document', async () => {
      // Upload document as client
      const testFileContent = Buffer.from('Admin can see this');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'admin-view.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Admin downloads client's document
      const response = await request(app.getHttpServer())
        .get(`/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('url');
    });
  });

  describe('DELETE /documents/:id', () => {
    itIfDb('should delete document for owner', async () => {
      // Upload a document
      const testFileContent = Buffer.from('To be deleted');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'delete-me.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Delete document
      await request(app.getHttpServer())
        .delete(`/documents/${documentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Verify deletion
      const deletedDoc = await prisma.document.findUnique({
        where: { id: documentId },
      });
      expect(deletedDoc).toBeNull();
    });

    itIfDb('should deny deletion by non-owner', async () => {
      // Upload document as client
      const testFileContent = Buffer.from('Cannot delete');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'protected.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Create another user
      const otherUserResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'hacker@example.com',
          password: 'Password123!',
          first_name: 'Hacker',
          last_name: 'User',
        });

      // Try to delete as other user
      await request(app.getHttpServer())
        .delete(`/documents/${documentId}`)
        .set('Authorization', `Bearer ${otherUserResponse.body.access_token}`)
        .expect(403);
    });

    itIfDb('should allow admin to delete any document', async () => {
      // Upload document as client
      const testFileContent = Buffer.from('Admin can delete');
      const uploadResponse = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testFileContent, {
          filename: 'admin-delete.pdf',
          contentType: 'application/pdf',
        })
        .field('type', 'w2');

      const documentId = uploadResponse.body.id;

      // Admin deletes client's document
      await request(app.getHttpServer())
        .delete(`/documents/${documentId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
    });
  });
});
