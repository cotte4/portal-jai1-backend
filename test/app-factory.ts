/**
 * Test App Factory
 *
 * Creates a NestJS application instance for integration testing.
 * This allows testing the full HTTP request/response cycle.
 *
 * Usage:
 * ```typescript
 * let app: INestApplication;
 *
 * beforeAll(async () => {
 *   app = await createTestApp();
 * });
 *
 * afterAll(async () => {
 *   await app.close();
 * });
 *
 * it('should work', () => {
 *   return request(app.getHttpServer())
 *     .get('/health')
 *     .expect(200);
 * });
 * ```
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';

// Import the app module
import { AppModule } from '../src/app.module';

// Import services that need mocking
import { EmailService } from '../src/common/services';
import { SupabaseService } from '../src/config/supabase.service';

/**
 * Create a mock EmailService that doesn't actually send emails
 */
function createMockEmailService() {
  return {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendNotificationEmail: jest.fn().mockResolvedValue(true),
    sendEmail: jest.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock SupabaseService that doesn't connect to Supabase
 */
function createMockSupabaseService() {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://mock-url.com/file'),
    uploadFile: jest.fn().mockResolvedValue({ path: 'mock/path/file.pdf' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    listFiles: jest.fn().mockResolvedValue([]),
    getClient: jest.fn().mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          upload: jest.fn().mockResolvedValue({ data: { path: 'mock/path' }, error: null }),
          download: jest.fn().mockResolvedValue({ data: Buffer.from('mock'), error: null }),
          remove: jest.fn().mockResolvedValue({ data: null, error: null }),
          createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://mock-url.com' }, error: null }),
        }),
      },
    }),
  };
}

/**
 * Options for creating the test app
 */
export interface CreateTestAppOptions {
  /**
   * Whether to mock external services (email, storage)
   * Default: true
   */
  mockExternalServices?: boolean;

  /**
   * Additional module overrides
   */
  overrides?: Array<{
    module: any;
    provider: any;
    useValue: any;
  }>;
}

/**
 * Creates a fully configured NestJS application for integration testing
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<INestApplication> {
  const { mockExternalServices = true, overrides = [] } = options;

  // Load test environment variables
  process.env.NODE_ENV = 'test';

  // Create the testing module builder
  let moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: path.join(__dirname, '../.env.test'),
      }),
      AppModule,
    ],
  });

  // Mock external services if requested
  if (mockExternalServices) {
    moduleBuilder = moduleBuilder
      .overrideProvider(EmailService)
      .useValue(createMockEmailService())
      .overrideProvider(SupabaseService)
      .useValue(createMockSupabaseService());
  }

  // Apply additional overrides
  for (const override of overrides) {
    moduleBuilder = moduleBuilder
      .overrideProvider(override.provider)
      .useValue(override.useValue);
  }

  // Compile the module
  const moduleFixture: TestingModule = await moduleBuilder.compile();

  // Create the app
  const app = moduleFixture.createNestApplication();

  // Apply the same pipes as the real app
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Initialize the app
  await app.init();

  return app;
}

/**
 * Helper to get a service from the test app
 */
export function getService<T>(app: INestApplication, service: new (...args: any[]) => T): T {
  return app.get<T>(service);
}
