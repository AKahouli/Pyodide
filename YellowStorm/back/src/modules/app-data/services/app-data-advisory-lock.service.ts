import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '@modules/postgres/postgres.constants';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import { advisoryLockKey } from '../utils/app-data-sql.util';

@Injectable()
export class AppDataAdvisoryLockService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async withLock<T>(
    appDataId: string,
    environment: AppDataEnvironment,
    fn: () => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const key = advisoryLockKey(appDataId, environment);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
