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
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Postgres ping failed', { error: (error as Error).message });
      return false;
    }
  }
}
