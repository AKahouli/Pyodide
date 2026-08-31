import { Injectable, Logger } from '@nestjs/common';
import { PostgresConnectionService } from '../postgres/postgres-connection.service';

export interface PostgresDiagnostics {
  status: 'available' | 'unavailable';
  sampledAt: string;
  pool: ReturnType<PostgresConnectionService['getPoolStats']>;
  database?: { connections: number; commits: number; rollbacks: number; deadlocks: number; statsResetAt: string | null };
  unavailable?: { reason: string };
}

@Injectable()
export class PostgresHealthService {
  private readonly logger = new Logger(PostgresHealthService.name);
  private cached?: { expiresAt: number; value: PostgresDiagnostics };
  private inFlight?: Promise<PostgresDiagnostics>;

  constructor(private readonly postgres: PostgresConnectionService) {}

  getDiagnostics(): Promise<PostgresDiagnostics> {
    if (this.cached && this.cached.expiresAt > Date.now()) return Promise.resolve(this.cached.value);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sample().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async sample(): Promise<PostgresDiagnostics> {
    const base = { sampledAt: new Date().toISOString(), pool: this.postgres.getPoolStats() };
    const client = await this.postgres.getPool().connect().catch(() => null);
    if (!client) {
      return { ...base, status: 'unavailable', unavailable: { reason: 'statistics unavailable' } };
    }
    try {
      await client.query('SET statement_timeout TO 1500');
      const result = await client.query(`SELECT numbackends::int AS connections, xact_commit::bigint AS commits,
          xact_rollback::bigint AS rollbacks, deadlocks::bigint AS deadlocks,
          stats_reset AS "statsResetAt" FROM pg_stat_database WHERE datname = current_database()`);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const value: PostgresDiagnostics = row
        ? {
            ...base,
            status: 'available',
            database: {
              connections: Number(row.connections),
              commits: Number(row.commits),
              rollbacks: Number(row.rollbacks),
              deadlocks: Number(row.deadlocks),
              statsResetAt: row.statsResetAt instanceof Date ? row.statsResetAt.toISOString() : null,
            },
          }
        : { ...base, status: 'unavailable', unavailable: { reason: 'statistics unavailable' } };
      this.cached = { value, expiresAt: Date.now() + 15_000 };
      return value;
    } catch {
      const value: PostgresDiagnostics = {
        ...base,
        status: 'unavailable',
        unavailable: { reason: 'statistics unavailable' },
      };
      this.cached = { value, expiresAt: Date.now() + 15_000 };
      return value;
    } finally {
      try {
        await client.query('SET statement_timeout TO DEFAULT');
      } catch (error) {
        this.logger.warn(`Failed to reset PostgreSQL diagnostics timeout: ${(error as Error).message}`);
      } finally {
        client.release();
      }
    }
  }
}
