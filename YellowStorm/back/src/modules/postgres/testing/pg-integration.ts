import * as path from 'path';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../schema';

// Load back/.env (cwd is back/ when jest runs) so POSTGRES_* are visible.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export function pgAvailable(): boolean {
  return Boolean(process.env.POSTGRES_HOST);
}

export const describeIntegration: jest.Describe = pgAvailable() ? describe : describe.skip;

export function makeTestDb(): { db: NodePgDatabase<typeof schema>; pool: Pool; close: () => Promise<void> } {
  // Prefer a dedicated test database so integration tests can never pollute or
  // wipe the real agent datastore (POSTGRES_DB). Falls back to POSTGRES_DB.
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_TEST_DB || process.env.POSTGRES_DB,
    max: 3,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export async function deleteAgents(db: NodePgDatabase<typeof schema>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(schema.agents).where(inArray(schema.agents.id, ids));
}
