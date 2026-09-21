/**
 * Steps 1B.3.4 + 1B.4.8 — cross-schema FK pass for the catalog phase.
 *   identity.users.plan_id           → catalog.plans(id)         (NO ACTION)
 *   agents.agent_type_id             → catalog.agent_types(id)   (NO ACTION)
 *   agent_tools.tool_id              → catalog.tools(id)         (CASCADE)
 *   agent_skills.skill_id            → catalog.skills(id)        (CASCADE)
 *   agent_disabled_skills.skill_id   → catalog.skills(id)        (CASCADE)
 * Definitions live in fk-specs.ts. Each FK is added NOT VALID only when missing
 * (or replaced when drifted) and validated when no orphan remains; re-running on a
 * live database is a no-op (this script used to drop and re-add validated constraints).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-catalog-fk.ts [--dry-run] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(
  fkSpecs(
    'fk_users_plan',
    'fk_agents_agent_type',
    'fk_agent_tools_tool',
    'fk_agent_skills_skill',
    'fk_agent_disabled_skills_skill',
  ),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
