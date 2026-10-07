import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'YelloStorm',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3000'}`,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  githubCallbackUrl: process.env.GITHUB_CALLBACK_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /**
   * Express `trust proxy` (TRUST_PROXY). Empty/false = ignore X-Forwarded-*.
   * Production behind an ingress should set hop count (e.g. `1`) or proxy CIDRs.
   */
  trustProxy: process.env.TRUST_PROXY || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  memoryLimitMb: Number.parseInt(process.env.MEMORY_LIMIT_MB || '512', 10),
  encryptionKey: process.env.ENCRYPTION_KEY || '',
}));
