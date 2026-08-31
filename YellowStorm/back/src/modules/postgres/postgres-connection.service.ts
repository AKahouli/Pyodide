import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { LoggerService } from '../logger';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import type * as schema from './schema';

@Injectable()
export class PostgresConnectionService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConnectionService.name);
  }

  getPool(): Pool {
    return this.pool;
  }

  getDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  async ping(): Promise<boolean> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return false;
    try {
      await client.query('SET statement_timeout TO 1500');
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Postgres ping failed', { error: (error as Error).message });
      return false;
    } finally {
      try {
        await client.query('SET statement_timeout TO DEFAULT');
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
}
