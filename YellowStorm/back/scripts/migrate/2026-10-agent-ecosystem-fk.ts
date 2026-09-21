/**
 * Step 4 FK pass — channels / shares / teams cross-references.
 *   telegram_chat_bindings.conversation_id → conversation.conversations(id) ON DELETE SET NULL
 *   User / agent FKs (NO ACTION): telegram_chat_bindings.{user_id,agent_id},
 *     telegram_integrations.user_id, widget_tokens.created_by,
 *     shared_agents.{shared_with,shared_by}, shared_teams.{shared_with,shared_by},
 *     teams.created_by
 * Definitions live in fk-specs.ts. A spec with orphans stays NOT VALID (still enforced
 * for new writes) and is reported for P10; the others proceed. Exit code 1 while any
 * orphan remains. WhatsApp FKs are skipped: the channel is deprecated (cleanup deferred).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-agent-ecosystem-fk.ts [--dry-run] [--drop]
 */
import { runFkSpecs } from './fk-helper';
import { fkSpecs } from './fk-specs';

runFkSpecs(
  fkSpecs(
    'fk_telegram_chat_bindings_conversation',
    'fk_telegram_chat_bindings_user',
    'fk_telegram_chat_bindings_agent',
    'fk_telegram_integrations_user',
    'fk_widget_tokens_created_by',
    'fk_shared_agents_shared_with',
    'fk_shared_agents_shared_by',
    'fk_shared_teams_shared_with',
    'fk_shared_teams_shared_by',
    'fk_teams_created_by',
  ),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
