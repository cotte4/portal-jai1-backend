// Sentry must be imported first
import './instrument';

import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable CSP for now (can cause issues with some frontends)
      crossOriginEmbedderPolicy: false, // Disable for iframe compatibility
    }),
  );

  // Enable gzip compression (30-50% smaller responses)
  app.use(
    compression({
      level: 6, // Balance between compression ratio and CPU usage
      threshold: 1024, // Only compress responses > 1KB
    }),
  );

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true, // Reduce explicit conversions
      },
    }),
  );

  // Enable CORS
  const isDev = configService.get<string>('NODE_ENV') !== 'production';
  const frontendUrl = configService.get<string>('FRONTEND_URL');

  // Allow multiple origins: configured FRONTEND_URL + Vercel preview URLs
  const allowedOrigins = isDev
    ? true
    : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) {
          callback(null, true);
          return;
        }

        // Check if origin matches FRONTEND_URL or is a Vercel preview URL
        const isAllowed =
          origin === frontendUrl ||
          origin === frontendUrl?.replace(/\/$/, '') || // Without trailing slash
          (origin.includes('portal-jai1') && origin.endsWith('.vercel.app')); // Vercel preview/production URLs

        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      };

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Global prefix for all routes
  app.setGlobalPrefix('v1');

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Portal JAI1 API')
    .setDescription('API para gestión de tax refunds - Estudiantes J-1')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Export OpenAPI spec for frontend type generation
  if (isDev || process.env.GENERATE_OPENAPI === 'true') {
    writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
    console.log('📄 OpenAPI spec written to openapi.json');
  }

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');

  // Configure HTTP keep-alive (reduces TCP overhead)
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65000; // 65 seconds (longer than ALB/proxy timeout)
  server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout

  console.log(`🚀 Portal JAI1 Backend running on port ${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api`);
  console.log(`⚡ Compression enabled, keep-alive: 65s`);
}
bootstrap();
