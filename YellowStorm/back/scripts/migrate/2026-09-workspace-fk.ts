/**
 * Step D.11: cross-schema FKs between the migrated workspace tables and their
 * dependents. Delete actions match drizzle/0020: junction rows cascade, the
 * conversation's system-workspace pointer is nulled.
 * Idempotent; replaces a drifted definition. Rollback: run with --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-workspace-fk.ts [--drop]
 */
import { runFkSpecs } from './fk-helper';

runFkSpecs([
  {
    name: 'fk_artifacts_workspace',
    table: 'workspace.workspace_artifacts',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM workspace.workspace_artifacts a
                   WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = a.workspace_id)`,
  },
  {
    name: 'fk_conv_ws_workspace',
    table: 'conversation.conversation_workspaces',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversation_workspaces cw
                   WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = cw.workspace_id)`,
  },
  {
    name: 'fk_conversations_system_workspace',
    table: 'conversation.conversations',
    definition: 'FOREIGN KEY (system_workspace_id) REFERENCES workspace.workspaces(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversations c
                   WHERE c.system_workspace_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = c.system_workspace_id)`,
  },
]).catch((e) => {
  console.error(e);
  process.exit(1);
});
