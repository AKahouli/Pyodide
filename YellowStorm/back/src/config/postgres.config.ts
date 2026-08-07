import { registerAs } from '@nestjs/config';

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  maxPoolSize: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

export default registerAs('postgres', (): PostgresConfig => ({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'yellostorm',
  ssl: process.env.POSTGRES_SSL === 'true',
  maxPoolSize: Number.parseInt(process.env.POSTGRES_MAX_POOL_SIZE || '10', 10),
  idleTimeoutMs: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMs: Number.parseInt(process.env.POSTGRES_CONNECT_TIMEOUT || '10000', 10),
}));
