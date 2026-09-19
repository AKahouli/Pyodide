/**
 * Step D.11: cross-schema FKs between the migrated workspace tables and their
 * dependents, added NOT VALID, validated when orphan counts are zero.
 * Idempotent. Part of the D.10 rollback procedure: run with --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-workspace-fk.ts [--drop]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface FkSpec {
  name: string;
  table: string;
  add: string;
  orphanCheck: string;
}

const SPECS: FkSpec[] = [
  {
    name: 'fk_artifacts_workspace',
    table: 'workspace.workspace_artifacts',
    add: `ALTER TABLE workspace.workspace_artifacts ADD CONSTRAINT fk_artifacts_workspace
          FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM workspace.workspace_artifacts a
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = a.workspace_id)`,
  },
  {
    name: 'fk_conv_ws_workspace',
    table: 'conversation.conversation_workspaces',
    add: `ALTER TABLE conversation.conversation_workspaces ADD CONSTRAINT fk_conv_ws_workspace
          FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversation_workspaces cw
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = cw.workspace_id)`,
  },
  {
    name: 'fk_conversations_system_workspace',
    table: 'conversation.conversations',
    add: `ALTER TABLE conversation.conversations ADD CONSTRAINT fk_conversations_system_workspace
          FOREIGN KEY (system_workspace_id) REFERENCES workspace.workspaces(id) NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversations c
                  WHERE c.system_workspace_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = c.system_workspace_id)`,
  },
];

async function main(): Promise<void> {
  const drop = process.argv.includes('--drop');
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });

  if (drop) {
    for (const spec of SPECS) {
      await pool.query(`ALTER TABLE ${spec.table} DROP CONSTRAINT IF EXISTS ${spec.name}`);
      console.log(`${spec.name}: dropped from ${spec.table}`);
    }
    await pool.end();
    return;
  }

  let exitCode = 0;
  for (const spec of SPECS) {
    const existing = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [spec.name]);
    if (existing.rowCount === 0) {
      await pool.query(spec.add);
      console.log(`${spec.name}: added (NOT VALID)`);
    } else {
      console.log(`${spec.name}: already exists`);
    }

    const { rows } = await pool.query(spec.orphanCheck);
    if (rows[0].n === 0) {
      await pool.query(`ALTER TABLE ${spec.table} VALIDATE CONSTRAINT ${spec.name}`);
      console.log(`${spec.name}: validated (0 orphan refs)`);
    } else {
      console.log(`${spec.name}: ${rows[0].n} orphan refs — left NOT VALID`);
      exitCode = 1;
    }
  }

  await pool.end();
  if (exitCode) process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
