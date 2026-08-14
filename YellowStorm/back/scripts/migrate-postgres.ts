/**
 * Apply Drizzle migrations to the Postgres agent store.
 *
 * Uses the SAME connection logic as backfill-agents-to-postgres.ts (loads back/.env
 * and the POSTGRES_* vars) so migrations always land in the exact database the
 * backfill targets — not the drizzle.config.ts fallback defaults.
 *
 * Usage:
 *   npx ts-node back/scripts/migrate-postgres.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });
  const db = drizzle(pool);

  const { rows } = await pool.query('select current_database() as db');
  console.log(`Applying migrations to database: ${rows[0].db}`);

  await migrate(db, { migrationsFolder: path.resolve(__dirname, '..', 'drizzle') });

  console.log('Migrations applied successfully.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
