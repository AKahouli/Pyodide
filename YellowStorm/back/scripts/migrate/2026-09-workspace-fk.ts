/**
 * Step D.11: cross-schema FKs between the migrated workspace tables and their
 * dependents. Delete actions match drizzle/0020 (junction rows cascade, the
 * conversation's system-workspace pointer is nulled). Definitions live in
 * fk-specs.ts. Idempotent; replaces a drifted definition. Rollback: --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-workspace-fk.ts [--dry-run] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(
  fkSpecs('fk_artifacts_workspace', 'fk_conv_ws_workspace', 'fk_conversations_system_workspace'),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
