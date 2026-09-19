/**
 * Step E.13: cross-schema FKs from governance tables to the migrated
 * workspace tables, added NOT VALID, validated when orphan counts are zero.
 * Idempotent. Part of the E.10 rollback procedure: run with --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-governance-fk.ts [--drop]
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
    name: 'fk_gov_docs_document',
    table: 'governance.governance_documents',
    add: `ALTER TABLE governance.governance_documents ADD CONSTRAINT fk_gov_docs_document
          FOREIGN KEY (document_id) REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM governance.governance_documents d
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspace_documents w WHERE w.id = d.document_id)`,
  },
  {
    name: 'fk_gov_docs_workspace',
    table: 'governance.governance_documents',
    add: `ALTER TABLE governance.governance_documents ADD CONSTRAINT fk_gov_docs_workspace
          FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM governance.governance_documents d
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = d.workspace_id)`,
  },
  {
    name: 'fk_gov_bindings_workspace',
    table: 'governance.governance_workspace_bindings',
    add: `ALTER TABLE governance.governance_workspace_bindings ADD CONSTRAINT fk_gov_bindings_workspace
          FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE NOT VALID`,
    orphanCheck: `SELECT count(*)::int AS n FROM governance.governance_workspace_bindings b
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = b.workspace_id)`,
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
