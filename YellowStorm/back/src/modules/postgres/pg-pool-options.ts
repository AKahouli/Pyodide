import { existsSync, readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { Pool, PoolClient } from 'pg';

/** Minimal logger surface so this module works with LoggerService or Nest Logger. */
export interface PgPoolLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface PgSslSettings {
  /** Whether SSL is enabled at all. */
  enabled: boolean;
  /** CA certificate: PEM contents, or a filesystem path to a PEM file. */
  ca?: string;
  /**
   * Verify the server certificate. When unset: true if a CA is provided,
   * otherwise false (backwards-compatible with the previous behaviour).
   */
  rejectUnauthorized?: boolean;
}

/** Resolve a CA value that may be inline PEM or a path to a PEM file. */
export function resolvePgSslCa(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(/\\n/g, '\n');
  if (existsSync(trimmed)) return readFileSync(trimmed, 'utf8');
  throw new Error('POSTGRES_SSL_CA is neither PEM contents nor an existing file path');
}

/**
 * Single SSL-options builder shared by every pg Pool in the app (main,
 * semantic-model, memory-cards). Logs a WARN when SSL is on but the server
 * certificate is not verified.
 */
export function buildPgSslOptions(
  settings: PgSslSettings,
  logger?: PgPoolLogger,
  label = 'postgres',
): ConnectionOptions | undefined {
  if (!settings.enabled) return undefined;
  const ca = resolvePgSslCa(settings.ca);
  const rejectUnauthorized = settings.rejectUnauthorized ?? Boolean(ca);
  if (!rejectUnauthorized) {
    logger?.warn(
      `[${label}] PostgreSQL SSL is enabled WITHOUT server certificate verification; set POSTGRES_SSL_CA and POSTGRES_SSL_REJECT_UNAUTHORIZED=true`,
    );
  }
  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value === 'true';
}

function parseIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Shared SSL CA / verification settings from env (POSTGRES_SSL_CA, POSTGRES_SSL_REJECT_UNAUTHORIZED). */
export function sslSettingsFromEnv(enabled: boolean, env: NodeJS.ProcessEnv = process.env): PgSslSettings {
  return {
    enabled,
    ca: env.POSTGRES_SSL_CA || undefined,
    rejectUnauthorized: parseBool(env.POSTGRES_SSL_REJECT_UNAUTHORIZED),
  };
}

export interface PgAuxPoolTuning {
  max: number;
  statement_timeout: number;
  idle_in_transaction_session_timeout: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  keepAlive: boolean;
  keepAliveInitialDelayMillis: number;
  application_name: string;
}

/**
 * Safe pool tuning for auxiliary pools (semantic-model, memory-cards).
 * Env keys: `${prefix}_POOL_MAX`, `${prefix}_STATEMENT_TIMEOUT`,
 * `${prefix}_IDLE_IN_TRANSACTION_TIMEOUT`, `${prefix}_CONNECT_TIMEOUT`.
 */
export function auxPoolTuningFromEnv(
  prefix: string,
  appNameSuffix: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: { max?: number; statementTimeoutMs?: number } = {},
): PgAuxPoolTuning {
  const baseName = `${env.APP_NAME || 'yellostorm-back'}:${env.REPLICA_ID || env.HOSTNAME || 'local'}`;
  return {
    max: overrides.max ?? parseIntOr(env[`${prefix}_POOL_MAX`], 5),
    statement_timeout: parseIntOr(env[`${prefix}_STATEMENT_TIMEOUT`], overrides.statementTimeoutMs ?? 30_000),
    idle_in_transaction_session_timeout: parseIntOr(env[`${prefix}_IDLE_IN_TRANSACTION_TIMEOUT`], 30_000),
    connectionTimeoutMillis: parseIntOr(env[`${prefix}_CONNECT_TIMEOUT`], 10_000),
    idleTimeoutMillis: 30_000,
    keepAlive: env.POSTGRES_KEEPALIVE !== 'false',
    keepAliveInitialDelayMillis: parseIntOr(env.POSTGRES_KEEPALIVE_INITIAL_DELAY, 10_000),
    application_name: `${baseName}${appNameSuffix}`.slice(0, 63),
  };
}

/**
 * pg-pool only listens for 'error' on IDLE clients; a checked-out client
 * whose socket dies (e.g. server kills an idle-in-transaction session) would
 * otherwise emit an unhandled 'error' and crash the process. Attach a
 * permanent per-client listener on connect. Never rethrows.
 */
export function attachCheckedOutClientErrorHandler(pool: Pool, logger: PgPoolLogger, label: string): void {
  pool.on('connect', (client: PoolClient) => {
    client.on('error', (err: Error) => {
      logger.error(`[${label}] PostgreSQL client connection error`, {
        error: err.message,
        code: (err as { code?: string }).code,
      });
    });
  });
}
