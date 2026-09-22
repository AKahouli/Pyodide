import * as path from 'path';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../schema';

// Load back/.env (cwd is back/ when jest runs) so POSTGRES_* are visible.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export function pgAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const testDatabase = env.POSTGRES_TEST_DB?.trim();
  return Boolean(
    env.POSTGRES_HOST
      && testDatabase
      && testDatabase !== env.POSTGRES_DB?.trim(),
  );
}

// Real-database round trips (remote server, or a busy CI runner) routinely exceed jest's
// 5 s default under load; a slow query must not read as a failed assertion.
if (pgAvailable()) jest.setTimeout(30_000);

export const describeIntegration: jest.Describe = pgAvailable() ? describe : describe.skip;

export function makeTestDb(): { db: NodePgDatabase<typeof schema>; pool: Pool; close: () => Promise<void> } {
  // Never fall back to the application database: these suites delete fixtures.
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: pgAvailable() ? process.env.POSTGRES_TEST_DB : '__yellowstorm_test_db_required__',
    max: 3,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export async function deleteAgents(db: NodePgDatabase<typeof schema>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(schema.agents).where(inArray(schema.agents.id, ids));
}
