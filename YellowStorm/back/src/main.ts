import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { inspect } from 'node:util';
import { URL } from 'node:url';
import { AppModule } from './app.module';
import { LoggerService } from './modules/logger';

function serializeUnhandledReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      type: reason.constructor?.name || 'Error',
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
      cause: reason.cause ? inspect(reason.cause, { depth: 5 }) : undefined,
    };
  }

  if (typeof reason === 'object' && reason !== null) {
    return {
      type: reason.constructor?.name || 'object',
      inspected: inspect(reason, { depth: 8, breakLength: 120 }),
    };
  }

  return {
    type: typeof reason,
    value: String(reason),
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = await app.resolve(LoggerService);
  logger.setContext('Bootstrap');
  app.useLogger(logger);
  const mongoUri = configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/yellostorm');
  try {
    const parsedMongoUri = new URL(mongoUri);
    logger.log('Resolved runtime database configuration', {
      mongoHost: parsedMongoUri.host,
      mongoDatabase: parsedMongoUri.pathname.replace(/^\//, '') || 'unknown',
    });
  } catch {
    logger.warn('Failed to parse runtime database configuration', { mongoUri });
  }
  const corsOrigins = configService.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  const allowedOrigins = corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigin = allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins;

  // CORS - use NestJS built-in for proper integration
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Correlation-ID',
      'X-Request-ID',
      'Cache-Control',
      'Connection',
    ],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Compression - Disabled temporarily to ensure SSE streaming is not buffered
  // app.use(compression({ threshold: 1024 }));

  // Body Size Limits
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Cookie Parser - Required for refresh token cookies
  app.use(cookieParser());

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: true,
    }),
  );

  // Swagger Documentation (non-production only)
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('YelloStorm API')
      .setDescription('AI Agent Chat Backend API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('health', 'Health check endpoints')
      .addTag('System (Experimental)', 'Experimental system management endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  const server = await app.listen(port, '0.0.0.0');

  // Request Timeout (5 minutes - better for parallel evaluations)
  server.setTimeout(300000);

  logger.log(`Application running on: http://localhost:${port}/${apiPrefix}`);
  if (configService.get<string>('NODE_ENV') !== 'production') {
    logger.log(`Swagger documentation: http://localhost:${port}/docs`);
  }

  // Graceful Shutdown Handler
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}. Starting graceful shutdown...`);
    server.close(() => {
      logger.log('HTTP server closed');
    });
    try {
      await app.close();
      logger.log('Application closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { message: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: serializeUnhandledReason(reason),
      promise: inspect(promise, { depth: 2, breakLength: 120 }),
    });
    void shutdown('unhandledRejection');
  });
}

void bootstrap();

