import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  attachCheckedOutClientErrorHandler,
  auxPoolTuningFromEnv,
  buildPgSslOptions,
  resolvePgSslCa,
  sslSettingsFromEnv,
} from './pg-pool-options';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

function logger() {
  return { warn: jest.fn(), error: jest.fn() };
}

describe('buildPgSslOptions', () => {
  it('returns undefined when SSL is disabled', () => {
    expect(buildPgSslOptions({ enabled: false, ca: PEM })).toBeUndefined();
  });

  it('keeps legacy no-verify behaviour without a CA and warns', () => {
    const log = logger();
    expect(buildPgSslOptions({ enabled: true }, log)).toEqual({ rejectUnauthorized: false });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('verifies by default when an inline PEM CA is provided', () => {
    const log = logger();
    expect(buildPgSslOptions({ enabled: true, ca: PEM }, log)).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('reads the CA from a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pgca-'));
    const file = join(dir, 'ca.pem');
    writeFileSync(file, PEM);
    expect(buildPgSslOptions({ enabled: true, ca: file })).toEqual({ rejectUnauthorized: true, ca: PEM });
  });

  it('honours an explicit rejectUnauthorized override', () => {
    const log = logger();
    expect(buildPgSslOptions({ enabled: true, ca: PEM, rejectUnauthorized: false }, log)).toEqual({
      rejectUnauthorized: false,
      ca: PEM,
    });
    expect(log.warn).toHaveBeenCalled();
    expect(buildPgSslOptions({ enabled: true, rejectUnauthorized: true })).toEqual({ rejectUnauthorized: true });
  });

  it('unescapes \n in inline PEM and rejects a missing file', () => {
    expect(resolvePgSslCa(PEM.replace(/\n/g, '\n'))).toBe(PEM);
    expect(() => resolvePgSslCa('/definitely/missing/ca.pem')).toThrow('POSTGRES_SSL_CA');
  });

  it('reads shared SSL settings from env', () => {
    expect(sslSettingsFromEnv(true, { POSTGRES_SSL_CA: PEM, POSTGRES_SSL_REJECT_UNAUTHORIZED: 'false' })).toEqual({
      enabled: true,
      ca: PEM,
      rejectUnauthorized: false,
    });
    expect(sslSettingsFromEnv(true, {})).toEqual({ enabled: true, ca: undefined, rejectUnauthorized: undefined });
  });
});

describe('auxPoolTuningFromEnv', () => {
  it('applies safe defaults', () => {
    const t = auxPoolTuningFromEnv('MEMORY_PG', ':memory-cards', { APP_NAME: 'app', REPLICA_ID: 'r1' });
    expect(t).toEqual({
      max: 5,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      application_name: 'app:r1:memory-cards',
    });
  });

  it('reads prefixed env overrides', () => {
    const t = auxPoolTuningFromEnv('SEMANTIC_PG', ':semantic', {
      SEMANTIC_PG_STATEMENT_TIMEOUT: '5000',
      SEMANTIC_PG_CONNECT_TIMEOUT: '2000',
      POSTGRES_KEEPALIVE_INITIAL_DELAY: '3000',
    }, { max: 7, statementTimeoutMs: 60_000 });
    expect(t.max).toBe(7);
    expect(t.statement_timeout).toBe(5000);
    expect(t.connectionTimeoutMillis).toBe(2000);
    expect(t.keepAliveInitialDelayMillis).toBe(3000);
  });
});

describe('attachCheckedOutClientErrorHandler', () => {
  it('gives every connected client a permanent error listener that logs without throwing', () => {
    const pool = new EventEmitter();
    const log = logger();
    attachCheckedOutClientErrorHandler(pool as unknown as Pool, log, 'main');
    const client = new EventEmitter();
    pool.emit('connect', client);
    const err = Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), {
      code: '25P03',
    });
    // Without a listener EventEmitter would throw on 'error'.
    expect(() => client.emit('error', err)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[main]'), {
      error: err.message,
      code: '25P03',
    });
  });
});
