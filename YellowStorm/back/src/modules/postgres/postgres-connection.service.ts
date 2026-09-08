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

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConnectionService.name);
  }

  onModuleInit(): void {
    this.pool.on('error', (err: Error) => this.handlePoolClientError(err));
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
    if (!client) return false;
    try {
      await client.query('SET statement_timeout TO 1500');
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      if (logFailure) {
        this.logger.error('Postgres ping failed', { error: (error as Error).message });
      }
      return false;
    } finally {
      try {
        await client.query('SET statement_timeout TO DEFAULT');
      } catch (resetErr) {
        this.logger.warn('Failed to reset statement_timeout', { error: (resetErr as Error).message });
      } finally {
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

  /**
   * A dropped connection on a checked-out client (server restart, network drop,
   * server-side timeout) triggers a recovery probe loop. The pool reconnects
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
    this.logger.error('PostgreSQL connection error — recovery probe started', { error: err.message });
    this.startRecoveryProbe();
  }

  private startRecoveryProbe(): void {
    if (this.recoveryProbeTimer) return;
    this.recoveryProbeTimer = setInterval(() => {
      void this.probeRecovery();
    }, RECOVERY_PROBE_INTERVAL_MS);
    this.recoveryProbeTimer.unref();
  }

  private stopRecoveryProbe(): void {
    if (!this.recoveryProbeTimer) return;
    clearInterval(this.recoveryProbeTimer);
    this.recoveryProbeTimer = null;
  }

  private async probeRecovery(): Promise<void> {
    // Only the first failed probe of an episode logs at error level.
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
    } else {
      this.failedProbeCount += 1;
    }
  }
}
