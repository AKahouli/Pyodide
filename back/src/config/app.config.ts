import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'YelloStorm',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3000'}`,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  throttleTtl: parseInt(process.env.THROTTLE_TTL || '60', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  memoryLimitMb: parseInt(process.env.MEMORY_LIMIT_MB || '512', 10),
  encryptionKey: process.env.ENCRYPTION_KEY || '',
}));
