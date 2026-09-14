// Must stay the FIRST import: several modules read process.env at static
// import time (e.g. AppDataModule's controller selection) — before
// ConfigModule.forRoot() loads the same file later during bootstrap.
import 'dotenv/config';
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
import { SystemService } from './modules/system/system.service';
import { parseTrustProxySetting } from './common/utils/client-ip';
import { APP_DATA_CORS_REQUEST_HEADERS } from './modules/app-data/constants/app-data.constants';

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

  // Trust only configured proxy hops/CIDRs so req.ip is not attacker-controlled
  // via X-Forwarded-For / X-Real-IP (YS-03). Default TRUST_PROXY empty → false.
  const trustProxy = parseTrustProxySetting(
    configService.get<string>('app.trustProxy') ?? configService.get<string>('TRUST_PROXY'),
  );
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', trustProxy);
  logger.log('Express trust proxy configured', {
    trustProxy: trustProxy === false ? 'false' : trustProxy,
  });

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
  const envAllowedOrigins = corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const systemService = app.get(SystemService);
  await systemService.getCorsSettings();

  const isOriginAllowed = (requestOrigin: string | undefined): boolean => {
    if (!requestOrigin) {
      return true;
    }
    const allAllowed = new Set([
      ...envAllowedOrigins,
      ...systemService.getEnabledCorsOrigins(),
    ]);
    return allAllowed.has(requestOrigin);
  };

  // CORS: env baseline (CORS_ORIGIN) + admin whitelist from MongoDB
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (isOriginAllowed(requestOrigin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
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
      'Idempotency-Key',
      'Cache-Control',
      'Connection',
      'Last-Event-ID',
      ...APP_DATA_CORS_REQUEST_HEADERS,
      'Range',
    ],
    exposedHeaders: ['Set-Cookie', 'Accept-Ranges', 'Content-Disposition', 'Content-Length', 'Content-Range'],
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
  });
}

void bootstrap();

