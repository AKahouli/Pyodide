/**
 * Step E.13: cross-schema FKs from governance tables to the migrated workspace tables.
 *
 * governance_documents keeps opaque references to workspace documents/workspaces:
 * governance records are history and must outlive the workspace document (the outbox
 * handler archives them). The earlier fk_gov_docs_document / fk_gov_docs_workspace
 * cascade-deleted that history and are retired (see drizzle/0020).
 * Idempotent; replaces a drifted definition. Rollback: run with --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-governance-fk.ts [--drop]
 */
import { runFkSpecs } from './fk-helper';

runFkSpecs(
  [
    {
      name: 'fk_gov_bindings_workspace',
      table: 'governance.governance_workspace_bindings',
      definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
      orphanCheck: `SELECT count(*)::int AS n FROM governance.governance_workspace_bindings b
                     WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = b.workspace_id)`,
    },
  ],
  [
    { name: 'fk_gov_docs_document', table: 'governance.governance_documents', reason: 'governance history must survive document delete' },
    { name: 'fk_gov_docs_workspace', table: 'governance.governance_documents', reason: 'governance history must survive workspace delete' },
  ],
).catch((e) => {
  console.error(e);
  process.exit(1);
});
