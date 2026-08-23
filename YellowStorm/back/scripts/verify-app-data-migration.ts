/**
 * Verify app_data migration 0003 columns on the configured Postgres database.
 * Usage: npx ts-node scripts/verify-app-data-migration.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const db = await pool.query('select current_database() as db, inet_server_addr()::text as host');
  console.log('Connected:', db.rows[0]);

  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'app_data' AND table_name = 'apps'
      AND column_name IN ('jwt_secret', 'end_user_auth_enabled')
    ORDER BY column_name
  `);
  console.log('apps columns (0003):', cols.rows.map((r) => r.column_name));

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'app_data'
      AND table_name IN ('end_users', 'end_user_grants')
    ORDER BY table_name
  `);
  console.log('end-user tables:', tables.rows.map((r) => r.table_name));

  const migrations = await pool.query(`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `).catch(() => ({ rows: [] as { id: number; hash: string; created_at: string }[] }));
  console.log('drizzle migrations:', migrations.rows.length);
  for (const m of migrations.rows) {
    console.log(`  - ${m.created_at} ${m.hash?.slice(0, 16)}…`);
  }

  await pool.end();

  if (cols.rows.length < 2) {
    console.error('FAIL: jwt_secret / end_user_auth_enabled missing on app_data.apps');
    process.exit(1);
  }
  console.log('OK: migration 0003 schema present');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
