import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

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
  app.enableCors({
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false,
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
