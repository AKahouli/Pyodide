import { registerAs } from '@nestjs/config';

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  /** CA cert: PEM contents or path to a PEM file. */
  sslCa?: string;
  /** undefined = verify only when a CA is provided. */
  sslRejectUnauthorized?: boolean;
  maxPoolSize: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  keepAlive: boolean;
  keepAliveInitialDelayMs: number;
  applicationName: string;
}

export default registerAs('postgres', (): PostgresConfig => ({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'yellostorm',
  ssl: process.env.POSTGRES_SSL === 'true',
  sslCa: process.env.POSTGRES_SSL_CA || undefined,
  sslRejectUnauthorized:
    process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === undefined || process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === ''
      ? undefined
      : process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'true',
  maxPoolSize: Number.parseInt(process.env.POSTGRES_MAX_POOL_SIZE || '10', 10),
  idleTimeoutMs: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMs: Number.parseInt(process.env.POSTGRES_CONNECT_TIMEOUT || '10000', 10),
  statementTimeoutMs: Number.parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT || '30000', 10),
  idleInTransactionTimeoutMs: Number.parseInt(
    process.env.POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT || '30000',
    10,
  ),
  keepAlive: process.env.POSTGRES_KEEPALIVE !== 'false',
  keepAliveInitialDelayMs: Number.parseInt(process.env.POSTGRES_KEEPALIVE_INITIAL_DELAY || '10000', 10),
  applicationName: `${process.env.APP_NAME || 'yellostorm-back'}:${process.env.REPLICA_ID || process.env.HOSTNAME || 'local'}`,
}));
