/**
 * Step A.9: conversations.project_id → project.projects (ON DELETE SET NULL, as in
 * drizzle/0020). Definition lives in fk-specs.ts. Idempotent; rollback: --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-project-fk.ts [--dry-run] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(fkSpecs('fk_conversations_project')).catch((e) => {
  console.error(e);
  process.exit(1);
});
