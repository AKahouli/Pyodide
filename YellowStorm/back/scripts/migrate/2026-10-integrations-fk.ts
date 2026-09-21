/**
 * Step 3 FK pass — integrations schema cross-references.
 *   user_app_connections.app_key → connected_app_definitions(app_key)
 *   connector_skills.skill_id → catalog.skills(id)
 * Both created NOT VALID then validated; orphan reports run first.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-integrations-fk.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface FkSpec {
  name: string;
  table: string;
  ddl: string;
  orphanSql: string;
  /** Dead junction rows are deleted instead of aborting (matches 1B.4 practice). */
  cleanupSql?: string;
}

const FKS: FkSpec[] = [
  {
    name: 'fk_user_app_connections_app_key',
    table: 'integrations.user_app_connections',
    ddl: `ADD CONSTRAINT fk_user_app_connections_app_key
          FOREIGN KEY (app_key) REFERENCES integrations.connected_app_definitions(app_key)
          ON DELETE CASCADE
          NOT VALID`,
    orphanSql: `SELECT uac.id, uac.app_key FROM integrations.user_app_connections uac
                LEFT JOIN integrations.connected_app_definitions d ON d.app_key = uac.app_key
                WHERE d.id IS NULL`,
  },
  {
    name: 'fk_connector_skills_skill',
    table: 'integrations.connector_skills',
    ddl: `ADD CONSTRAINT fk_connector_skills_skill
          FOREIGN KEY (skill_id) REFERENCES catalog.skills(id)
          ON DELETE CASCADE
          NOT VALID`,
    orphanSql: `SELECT cs.connector_id, cs.skill_id FROM integrations.connector_skills cs
                LEFT JOIN catalog.skills s ON s.id = cs.skill_id
                WHERE s.id IS NULL`,
    cleanupSql: `DELETE FROM integrations.connector_skills cs
                 WHERE NOT EXISTS (SELECT 1 FROM catalog.skills s WHERE s.id = cs.skill_id)`,
  },
];

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const dryRun = process.argv.includes('--dry-run');

  for (const fk of FKS) {
    console.log(`=== ${fk.name} ===`);
    const orphans = await pool.query(fk.orphanSql);
    console.log(JSON.stringify({ orphanDocs: orphans.rowCount ?? 0, sample: orphans.rows.slice(0, 10) }, null, 2));
    if (dryRun) continue;

    if ((orphans.rowCount ?? 0) > 0 && fk.cleanupSql) {
      const removed = await pool.query(fk.cleanupSql);
      console.log(`cleaned dead junction rows: ${removed.rowCount}`);
    } else if ((orphans.rowCount ?? 0) > 0) {
      console.error(`Orphans present for ${fk.name} — resolve before adding the FK.`);
      await pool.end();
      process.exit(1);
    }

    await pool.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.name}`);
    await pool.query(`ALTER TABLE ${fk.table} ${fk.ddl}`);
    await pool.query(`ALTER TABLE ${fk.table} VALIDATE CONSTRAINT ${fk.name}`);
    const check = await pool.query<{ convalidated: boolean }>(
      'SELECT convalidated FROM pg_constraint WHERE conname = $1',
      [fk.name],
    );
    console.log(JSON.stringify({ validated: check.rows[0]?.convalidated ?? false }, null, 2));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
