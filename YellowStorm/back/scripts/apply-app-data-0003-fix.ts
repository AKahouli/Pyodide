/**
 * Apply 0003_app_data_end_users.sql directly (idempotent).
 * Use when Drizzle journal says 0003 is applied but columns/tables are missing.
 *
 * Usage: npx ts-node scripts/apply-app-data-0003-fix.ts
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const sqlPath = path.resolve(__dirname, '..', 'drizzle', '0003_app_data_end_users.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const { rows } = await pool.query('select current_database() as db');
  console.log(`Applying 0003 fix to database: ${rows[0].db}`);

  await pool.query(sql);
  console.log('0003 SQL applied.');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
