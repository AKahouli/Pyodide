/**
 * Step 3 FK pass — integrations schema cross-references.
 *   user_app_connections.app_key → connected_app_definitions(app_key)
 *   connector_skills.skill_id → catalog.skills(id)
 *   agent_connectors.connector_id → connectors(id) ON DELETE CASCADE (remediation 2.6)
 *   agent_connector_actions.connector_id → connectors(id) ON DELETE CASCADE (remediation 2.6)
 * Both created NOT VALID then validated; orphan reports run first.
 * Junction orphan cleanup is OPT-IN with --delete-orphans: rows are exported
 * to scripts/migrate/out/<table>-<timestamp>.json before deletion (remediation
 * 2.6/2.7 — never delete without an export).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-integrations-fk.ts [--dry-run] [--delete-orphans]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface FkSpec {
  name: string;
  table: string;
  ddl: string;
  orphanSql: string;
  /** Dead junction rows are deleted instead of aborting (matches 1B.4 practice). */
  cleanupSql?: string;
  /** Directory/file stem for --delete-orphans exports (requires cleanupSql). */
  exportStem?: string;
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
  {
    name: 'fk_agent_connectors_connector',
    table: 'public.agent_connectors',
    ddl: `ADD CONSTRAINT fk_agent_connectors_connector
          FOREIGN KEY (connector_id) REFERENCES integrations.connectors(id)
          ON DELETE CASCADE
          NOT VALID`,
    orphanSql: `SELECT ac.agent_id, ac.connector_id FROM public.agent_connectors ac
                LEFT JOIN integrations.connectors c ON c.id = ac.connector_id
                WHERE c.id IS NULL`,
    cleanupSql: `DELETE FROM public.agent_connectors ac
                 WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors c WHERE c.id = ac.connector_id)`,
    exportStem: 'agent_connectors',
  },
  {
    name: 'fk_agent_connector_actions_connector',
    table: 'public.agent_connector_actions',
    ddl: `ADD CONSTRAINT fk_agent_connector_actions_connector
          FOREIGN KEY (connector_id) REFERENCES integrations.connectors(id)
          ON DELETE CASCADE
          NOT VALID`,
    orphanSql: `SELECT aca.agent_id, aca.connector_id FROM public.agent_connector_actions aca
                LEFT JOIN integrations.connectors c ON c.id = aca.connector_id
                WHERE c.id IS NULL`,
    cleanupSql: `DELETE FROM public.agent_connector_actions aca
                 WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors c WHERE c.id = aca.connector_id)`,
    exportStem: 'agent_connector_actions',
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
  const deleteOrphans = process.argv.includes('--delete-orphans');

  for (const fk of FKS) {
    console.log(`=== ${fk.name} ===`);
    const orphans = await pool.query(fk.orphanSql);
    console.log(JSON.stringify({ orphanDocs: orphans.rowCount ?? 0, sample: orphans.rows.slice(0, 10) }, null, 2));
    if (dryRun) continue;

    if ((orphans.rowCount ?? 0) > 0 && fk.cleanupSql) {
      if (fk.exportStem) {
        // Opt-in with export: no deletion without --delete-orphans (2.6).
        if (!deleteOrphans) {
          console.error(`Orphans present for ${fk.name} — rerun with --delete-orphans to export + delete (opt-in).`);
          continue;
        }
        const outDir = path.resolve(__dirname, 'out');
        fs.mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, `${fk.exportStem}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(file, JSON.stringify(orphans.rows, null, 2));
        console.log(`exported ${orphans.rowCount} orphan rows → ${file}`);
      }
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
