import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { LoggerService } from '../logger';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import type * as schema from './schema';

export const RECOVERY_PROBE_INTERVAL_MS = 5000;

@Injectable()
export class PostgresConnectionService implements OnModuleInit, OnModuleDestroy {
  private recoveryProbeTimer: NodeJS.Timeout | null = null;
  private failedProbeCount = 0;
  private poolErrorAttached = false;
  // Non-secret episode diagnostics for operators.
  private outageSince: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastErrorClass: string | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConnectionService.name);
  }

  onModuleInit(): void {
    // Attach exactly once: double registration would double-log pool errors.
    if (this.poolErrorAttached) return;
    this.poolErrorAttached = true;
    this.pool.on('error', (err: Error) => this.handlePoolClientError(err));
    this.logEffectivePoolConfig();
  }

  /** One-shot startup log of the effective pool config (never the password). */
  private logEffectivePoolConfig(): void {
    const opts = (this.pool as unknown as { options?: Record<string, unknown> }).options;
    if (!opts) return;
    const ssl = opts.ssl as { rejectUnauthorized?: boolean; ca?: unknown } | boolean | undefined;
    this.logger.log('PostgreSQL pool configured', {
      host: opts.host,
      port: opts.port,
      database: opts.database,
      user: opts.user,
      max: opts.max,
      idleTimeoutMillis: opts.idleTimeoutMillis,
      connectionTimeoutMillis: opts.connectionTimeoutMillis,
      statementTimeout: opts.statement_timeout,
      idleInTransactionSessionTimeout: opts.idle_in_transaction_session_timeout,
      keepAlive: opts.keepAlive,
      keepAliveInitialDelayMillis: opts.keepAliveInitialDelayMillis,
      applicationName: opts.application_name,
      ssl: ssl ? { verify: typeof ssl === 'object' ? ssl.rejectUnauthorized !== false : true, ca: typeof ssl === 'object' && Boolean(ssl.ca) } : false,
    });
  }

  onModuleDestroy(): void {
    this.stopRecoveryProbe();
  }

  getPool(): Pool {
    return this.pool;
  }

  getDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  async ping(options: { logFailure?: boolean } = {}): Promise<boolean> {
    const { logFailure = true } = options;
    const client = await this.pool.connect().catch(() => null);
    if (!client) {
      this.lastErrorClass = 'CheckoutFailed';
      return false;
    }
    try {
      await client.query('SET statement_timeout TO 1500');
      await client.query('SELECT 1');
      this.lastSuccessAt = new Date();
      this.outageSince = null;
      this.lastErrorClass = null;
      return true;
    } catch (error) {
      this.lastErrorClass = (error as Error).name || 'QueryError';
      if (logFailure) {
        this.logger.error('Postgres ping failed', { error: (error as Error).message });
      }
      return false;
    } finally {
      let discarded = false;
      try {
        await client.query('SET statement_timeout TO DEFAULT');
      } catch (resetErr) {
        // The probe-scoped timeout is still active on this client. Releasing
        // it healthy would leak the 1500ms timeout into application work —
        // hand it back with an error so the pool destroys it instead.
        discarded = true;
        this.logger.warn('Failed to reset statement_timeout; discarding pooled client', {
          error: (resetErr as Error).message,
        });
        client.release(resetErr as Error);
      }
      if (!discarded) {
        client.release();
      }
    }
  }

  getPoolStats(): {
    totalCount: number;
    idleCount: number;
    checkedOutCount: number;
    waitingCount: number;
  } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      checkedOutCount: this.pool.totalCount - this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /** Non-secret recovery diagnostics: episode timing and probe progress. */
  getRecoveryInfo(): {
    outageSince: string | null;
    lastSuccessAt: string | null;
    lastErrorClass: string | null;
    failedProbeCount: number;
    probeActive: boolean;
  } {
    return {
      outageSince: this.outageSince ? this.outageSince.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      lastErrorClass: this.lastErrorClass,
      failedProbeCount: this.failedProbeCount,
      probeActive: this.recoveryProbeTimer !== null,
    };
  }

  /**
   * pg-pool emits 'error' on the pool only for IDLE clients (the per-client
   * idle listener is removed on checkout). Errors on checked-out clients are
   * handled by the per-client listener attached in the pool factory
   * (attachCheckedOutClientErrorHandler) and surface to the caller's query.
   * An idle-client error (server restart, network drop, server-side timeout)
   * triggers a recovery probe loop. The pool reconnects
   * lazily on the next query; the probe pings until the database answers again
   * so recovery is observable and the pool is warmed. Repeated errors and
   * failed probes within one outage episode are aggregated to avoid log floods.
   */
  private handlePoolClientError(err: Error): void {
    if (this.recoveryProbeTimer) {
      this.logger.debug('PostgreSQL connection error during active outage episode', { error: err.message });
      return;
    }
    this.failedProbeCount = 0;
    // Preserve the original episode start when errors arrive mid-outage.
    if (!this.outageSince) {
      this.outageSince = new Date();
    }
    this.logger.error('PostgreSQL connection error — recovery probe started', { error: err.message });
    this.startRecoveryProbe();
  }

  /**
   * Single-flight probing: the next probe is scheduled only after the previous
   * one completes, so a long connect timeout during a network black hole never
   * overlaps probes or accumulates pool waiters.
   */
  private startRecoveryProbe(): void {
    if (this.recoveryProbeTimer) return;
    const scheduleNext = (): void => {
      this.recoveryProbeTimer = setTimeout(() => {
        void this.probeRecovery().finally(() => {
          // The chain continues only while the outage episode is still active;
          // a successful probe stops the timer and the chain ends.
          if (this.recoveryProbeTimer !== null) scheduleNext();
        });
      }, RECOVERY_PROBE_INTERVAL_MS);
      this.recoveryProbeTimer.unref();
    };
    scheduleNext();
  }

  private stopRecoveryProbe(): void {
    if (!this.recoveryProbeTimer) return;
    clearTimeout(this.recoveryProbeTimer);
    this.recoveryProbeTimer = null;
  }

  private async probeRecovery(): Promise<void> {
    // Only the first failed probe of an episode logs at error level.
    const outageStartedAt = this.outageSince;
    const healthy = await this.ping({ logFailure: this.failedProbeCount === 0 }).catch(() => false);
    if (healthy) {
      const attempts = this.failedProbeCount;
      this.failedProbeCount = 0;
      this.stopRecoveryProbe();
      this.logger.log(
        attempts > 0
          ? `PostgreSQL connection recovered after ${attempts} failed probe(s)`
          : 'PostgreSQL connection recovered',
      );
      if (outageStartedAt) {
        this.logger.log('PostgreSQL outage episode summary', {
          outageSince: outageStartedAt.toISOString(),
          recoveredAt: new Date().toISOString(),
        });
      }
    } else {
      this.failedProbeCount += 1;
    }
  }
}
