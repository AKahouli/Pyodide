/**
 * Step 1B.3.4 — cross-schema FK pass for the catalog phase.
 *
 * Adds identity.users.plan_id → catalog.plans(id) once the plans backfill
 * has landed (NOT VALID → validate; orphan report first).
 * Further catalog FKs (tools/skills/agent-types) join here in 1B.4.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-catalog-fk.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const dryRun = process.argv.includes('--dry-run');

  // ── orphan report: users.plan_id NOT IN plans ───────────────────────
  const orphans = await pool.query(`
    SELECT u.id, u.plan_id
    FROM identity.users u
    LEFT JOIN catalog.plans p ON p.id = u.plan_id
    WHERE u.plan_id IS NOT NULL AND p.id IS NULL
  `);
  console.log('=== orphan report: identity.users.plan_id → catalog.plans ===');
  console.log(JSON.stringify({
    orphanDocs: orphans.rowCount ?? 0,
    sample: orphans.rows.slice(0, 20),
  }, null, 2));
  if ((orphans.rowCount ?? 0) > 0) {
    console.error('Orphans present — resolve before adding the FK.');
    await pool.end();
    process.exit(1);
  }

  if (dryRun) {
    console.log('dry-run: FK not created');
    await pool.end();
    return;
  }

  // ── FK: NOT VALID first, then validate ──────────────────────────────
  await pool.query(`
    ALTER TABLE identity.users
      DROP CONSTRAINT IF EXISTS fk_users_plan
  `);
  await pool.query(`
    ALTER TABLE identity.users
      ADD CONSTRAINT fk_users_plan
      FOREIGN KEY (plan_id) REFERENCES catalog.plans(id)
      NOT VALID
  `);
  await pool.query(`
    ALTER TABLE identity.users
      VALIDATE CONSTRAINT fk_users_plan
  `);

  const check = await pool.query<{ validated: boolean }>(
    `SELECT convalidated FROM pg_constraint WHERE conname = 'fk_users_plan'`,
  );
  console.log('=== fk_users_plan ===');
  console.log(JSON.stringify({ validated: check.rows[0]?.validated ?? false }, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
