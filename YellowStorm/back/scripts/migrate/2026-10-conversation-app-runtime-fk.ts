/**
 * Cross-schema FK pass for conversation-v2 and app-runtime (migration 0037).
 *   conversation_v2.sessions.owner_id / system_workspace_id  → identity.users / workspace.workspaces
 *   conversation_v2.app_shares.owner_id / recipient_user_id  → identity.users
 *   app_runtime.bindings.user_id, tickets.user_id, ai_preview_tickets.billable_user_id → identity.users
 *   app_runtime.{tickets,tool_calls,ai_preview_tickets}.binding_id, {source,finalized}_revisions.workspace_id
 *                                                            → app_runtime.bindings (CASCADE)
 * Definitions live in fk-specs.ts. The migration adds every constraint NOT VALID and validates the ones
 * without orphans; this script validates the rest once their orphans are handled:
 * `--delete-orphans` exports each dangling set to scripts/migrate/out/*.json first, then clears it
 * (a dangling system_workspace_id is set to NULL, the others are deleted with what hangs off them).
 *
 * Usage: npx ts-node scripts/migrate/2026-10-conversation-app-runtime-fk.ts [--dry-run] [--delete-orphans] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(
  fkSpecs(
    'fk_c2_sessions_owner',
    'fk_c2_sessions_system_workspace',
    'fk_c2_app_shares_owner',
    'fk_c2_app_shares_recipient',
    'fk_ar_bindings_user',
    'fk_ar_tickets_binding',
    'fk_ar_tickets_user',
    'fk_ar_tool_calls_binding',
    'fk_ar_ai_preview_tickets_binding',
    'fk_ar_ai_preview_tickets_billable_user',
    'fk_ar_source_revisions_binding',
    'fk_ar_finalized_revisions_binding',
  ),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
