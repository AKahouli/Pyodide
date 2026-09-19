/**
 * Step A.12: cross-schema FK conversation.conversations.project_id → project.projects.
 * ON DELETE SET NULL (deleting a project detaches its conversations; see 0020).
 * Idempotent; replaces a drifted definition. Rollback: run with --drop.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-project-fk.ts [--drop]
 */
import { runFkSpecs } from './fk-helper';

runFkSpecs([
  {
    name: 'fk_conversations_project',
    table: 'conversation.conversations',
    definition: 'FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversations c
                   WHERE c.project_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM project.projects p WHERE p.id = c.project_id)`,
  },
]).catch((e) => {
  console.error(e);
  process.exit(1);
});
