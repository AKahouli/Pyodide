/**
 * Cross-schema FK pass for the classifier (migration 0041): classifier.runs.playbook_id → playbook.flows (CASCADE).
 * The definition lives in fk-specs.ts. The migration adds the constraint NOT VALID (enforced for new writes) and
 * validates it when no run points at a missing playbook; the migration runs BEFORE the playbook backfill, so on
 * the deploy this script validates it afterwards: `--delete-orphans` exports the runs of playbooks that no longer
 * exist to scripts/migrate/out/*.json first, then removes them (their file assignments keep their folder).
 *
 * Usage: npx ts-node scripts/migrate/2026-10-classifier-playbook-fk.ts [--dry-run] [--delete-orphans] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(fkSpecs('fk_classifier_runs_playbook')).catch((e) => {
  console.error(e);
  process.exit(1);
});
