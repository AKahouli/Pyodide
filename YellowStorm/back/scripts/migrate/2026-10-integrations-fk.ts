/**
 * Step 3 FK pass — integrations schema cross-references.
 *   user_app_connections.app_key           → connected_app_definitions(app_key)  CASCADE
 *   connector_skills.skill_id              → catalog.skills(id)                  CASCADE
 *   agent_connectors.connector_id          → connectors(id)                      CASCADE (remediation 2.6)
 *   agent_connector_actions.connector_id   → connectors(id)                      CASCADE (remediation 2.6)
 * Definitions live in fk-specs.ts. Junction orphan cleanup is OPT-IN with
 * --delete-orphans: rows are exported to scripts/migrate/out/<stem>-<timestamp>.json
 * before they are deleted (never delete without an export).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-integrations-fk.ts [--dry-run] [--delete-orphans] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(
  fkSpecs(
    'fk_user_app_connections_app_key',
    'fk_connector_skills_skill',
    'fk_agent_connectors_connector',
    'fk_agent_connector_actions_connector',
  ),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
