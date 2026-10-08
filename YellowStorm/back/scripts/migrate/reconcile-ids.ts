/**
 * Read-only id-set reconciliation between Mongo and Postgres for every
 * migrated collection (plan 2026-09-21-postgres-migration-remediation, 0.2),
 * including the 2026-10 conversation-v2 / app-runtime / app-builder AI offer pairs.
 *
 * Flags:
 *   --allow=<file.json>  Ids expected to be missing in PG. JSON array or
 *                        {"<id>": "<reason>"} map (e.g. the 7 legacy widget
 *                        tokens with corrupt hashes).
 *   --since=<iso>        Drift mode: only Mongo ids created after this instant
 *                        count as problems (detects a live Mongo writer).
 *   --strict             Exit 1 on any non-allowed missing id, or on any drift.
 *
 * Read-only: the PG connection runs with default_transaction_read_only=on and
 * Mongo is only queried with find/count. Only ids and counts are printed.
 *
 * Usage: npx ts-node back/scripts/migrate/reconcile-ids.ts [--allow=...] [--since=...] [--strict]
 */
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/** [mongo collection, pg schema.table] — Appendix A of the remediation plan. */
const PAIRS: Array<[string, string]> = [
  ['users', 'identity.users'],
  ['roles', 'authz.roles'],
  ['user_groups', 'identity.user_groups'],
  ['auth_providers', 'identity.auth_providers'],
  ['user_provider_links', 'identity.user_provider_links'],
  ['notifications', 'ops.notifications'],
  ['system_settings', 'catalog.system_settings'],
  ['models', 'catalog.ai_models'],
  ['plans', 'catalog.plans'],
  ['tool_categories', 'catalog.tool_categories'],
  ['tools', 'catalog.tools'],
  ['skill_categories', 'catalog.skill_categories'],
  ['skills', 'catalog.skills'],
  ['agent_types', 'catalog.agent_types'],
  ['connector_categories', 'integrations.connector_categories'],
  ['connectors', 'integrations.connectors'],
  ['connector_credentials', 'integrations.connector_credentials'],
  ['connected_app_definitions', 'integrations.connected_app_definitions'],
  ['user_app_connections', 'integrations.user_app_connections'],
  ['admin_connector_auth_tokens', 'integrations.admin_connector_auth_tokens'],
  ['agent_telegram_integrations', 'channels.telegram_integrations'],
  ['telegram_chat_bindings', 'channels.telegram_chat_bindings'],
  ['widget_tokens', 'channels.widget_tokens'],
  ['shared_agents', 'public.shared_agents'],
  ['teams', 'teams.teams'],
  ['shared_teams', 'teams.shared_teams'],
  ['team_auto_builder_config', 'teams.auto_builder_config'],
];

interface KeyedPair {
  mongo: string;
  pg: string;
  /** Mongo field carrying the id when the backfill keys on it instead of `_id`. */
  mongoKey?: string;
  /** PG column carrying the id when it is not `id`. */
  pgKey?: string;
  /** The backfill lower-cases the id, so both sides are compared lower-cased. */
  lowerCase?: boolean;
}

/**
 * Collections migrated in 2026-10 (conversation-v2, app-runtime, app-builder AI
 * offers). Some tables key on a business id rather than `_id`.
 * `app_runtime_tickets` and `ai_preview_tickets` are ephemeral (TTL): their Mongo
 * collections are empty and Postgres holds only live tickets, so they are
 * deliberately not reconciled here.
 */
const NEW_MODULE_PAIRS: KeyedPair[] = [
  { mongo: 'conversation_v2_sessions', pg: 'conversation_v2.sessions', lowerCase: true },
  { mongo: 'conversation_v2_events', pg: 'conversation_v2.events', lowerCase: true },
  { mongo: 'conversation_v2_app_shares', pg: 'conversation_v2.app_shares', lowerCase: true },
  { mongo: 'app_runtime_bindings', pg: 'app_runtime.bindings', mongoKey: 'bindingId', pgKey: 'binding_id' },
  { mongo: 'app_source_revisions', pg: 'app_runtime.source_revisions', lowerCase: true },
  { mongo: 'app_finalized_revisions', pg: 'app_runtime.finalized_revisions', lowerCase: true },
  { mongo: 'app_runtime_tool_calls', pg: 'app_runtime.tool_calls', mongoKey: 'toolCallId', pgKey: 'tool_call_id' },
  { mongo: 'app_builder_ai_offers', pg: 'catalog.app_builder_ai_offers', lowerCase: true },
  { mongo: 'datasets', pg: 'agent_evaluation.datasets', lowerCase: true },
  { mongo: 'scenarios', pg: 'agent_evaluation.scenarios', lowerCase: true },
  { mongo: 'evaluations', pg: 'agent_evaluation.evaluations', lowerCase: true },
  { mongo: 'evaluation_settings', pg: 'agent_evaluation.settings', lowerCase: true },
  { mongo: 'knowledge_extraction_jobs', pg: 'governance.knowledge_extraction_jobs', lowerCase: true },
  { mongo: 'temporal_candidate_records', pg: 'governance.temporal_candidate_records', lowerCase: true },
  { mongo: 'knowledge_alerts', pg: 'governance.knowledge_alerts', lowerCase: true },
  { mongo: 'knowledge_assessments', pg: 'governance.knowledge_assessments', lowerCase: true },
  { mongo: 'knowledge_recommendations', pg: 'governance.knowledge_recommendations', lowerCase: true },
  { mongo: 'metadata_candidates', pg: 'governance.metadata_candidates', lowerCase: true },
  { mongo: 'classification_runs', pg: 'classifier.runs', lowerCase: true },
  { mongo: 'classifier_folders', pg: 'classifier.folders', lowerCase: true },
  { mongo: 'classifier_file_assignments', pg: 'classifier.file_assignments', lowerCase: true },
  { mongo: 'classifier_rules', pg: 'classifier.rules', lowerCase: true },
  { mongo: 'integration_events', pg: 'ops.integration_events', lowerCase: true },
  { mongo: 'worky_governance_policies', pg: 'worky.governance_policies', lowerCase: true },
  { mongo: 'worky_streams', pg: 'worky.streams', lowerCase: true },
  { mongo: 'worky_tasks', pg: 'worky.tasks', lowerCase: true },
  { mongo: 'worky_plan_deltas', pg: 'worky.plan_deltas', lowerCase: true },
  { mongo: 'worky_messages', pg: 'worky.messages', lowerCase: true },
  { mongo: 'worky_plan_versions', pg: 'worky.plan_versions', lowerCase: true },
  { mongo: 'worky_plan_projections', pg: 'worky.plan_projections', lowerCase: true },
  { mongo: 'worky_message_components', pg: 'worky.message_components', lowerCase: true },
  { mongo: 'worky_plan_step_components', pg: 'worky.plan_step_components', lowerCase: true },
  { mongo: 'worky_plan_step_artifacts', pg: 'worky.plan_step_artifacts', lowerCase: true },
  { mongo: 'worky_interactions', pg: 'worky.interactions', lowerCase: true },
  { mongo: 'worky_ephemeral_workers', pg: 'worky.ephemeral_workers', lowerCase: true },
  { mongo: 'worky_task_results', pg: 'worky.task_results', lowerCase: true },
  { mongo: 'worky_traces', pg: 'worky.traces', lowerCase: true },
  { mongo: 'worky_budget_reservations', pg: 'worky.budget_reservations', lowerCase: true },
  { mongo: 'worky_cost_events', pg: 'worky.cost_events', lowerCase: true },
  { mongo: 'worky_mail_event_ledger', pg: 'worky.mail_event_ledger', lowerCase: true },
  { mongo: 'worky_scheduled_events', pg: 'worky.scheduled_events', lowerCase: true },
  { mongo: 'worky_execution_reports', pg: 'worky.execution_reports', lowerCase: true },
  { mongo: 'worky_audit_events', pg: 'worky.audit_events', lowerCase: true },
  { mongo: 'worky_memory_proposals', pg: 'worky.memory_proposals', lowerCase: true },
  { mongo: 'worky_memory_entries', pg: 'worky.memory_entries', lowerCase: true },
  { mongo: 'worky_mail_subscriptions', pg: 'worky.mail_subscriptions', lowerCase: true },
  { mongo: 'flows', pg: 'playbook.flows', lowerCase: true },
  { mongo: 'shared_playbooks', pg: 'playbook.shared_playbooks', lowerCase: true },
  { mongo: 'flowexecutions', pg: 'playbook.executions', lowerCase: true },
  { mongo: 'flowtaskresults', pg: 'playbook.task_results', lowerCase: true },
  { mongo: 'flowrouterdecisions', pg: 'playbook.router_decisions', lowerCase: true },
  { mongo: 'flowidempotencyrecords', pg: 'playbook.idempotency_records', lowerCase: true },
  { mongo: 'playbook_flow_dynamic_reasoning_attempts', pg: 'playbook.dynamic_reasoning_attempts', lowerCase: true },
  { mongo: 'playbook_flow_node_templates', pg: 'playbook.node_templates', lowerCase: true },
  { mongo: 'playbook_flow_prompt_templates', pg: 'playbook.prompt_templates', lowerCase: true },
  { mongo: 'playbook_flow_output_formats', pg: 'playbook.output_formats', lowerCase: true },
  { mongo: 'playbook_flow_mail_event_ledgers', pg: 'playbook.mail_event_ledgers', lowerCase: true },
  { mongo: 'flowhitlmemories', pg: 'playbook.hitl_memories', lowerCase: true },
  { mongo: 'playbook_flow_design_messages', pg: 'playbook.design_messages', lowerCase: true },
  { mongo: 'flowdesignoperations', pg: 'playbook.design_operations', lowerCase: true },
  { mongo: 'playbook_flow_validated_replays', pg: 'playbook.validated_replays', lowerCase: true },
  { mongo: 'playbook_flow_replay_run_reports', pg: 'playbook.replay_run_reports', lowerCase: true },
  { mongo: 'playbook_flow_evaluation_baselines', pg: 'playbook.evaluation_baselines', lowerCase: true },
  { mongo: 'playbook_flow_evaluation_executions', pg: 'playbook.evaluation_executions', lowerCase: true },
  // Conversation v1 history (2026-10-conversation-v1.ts). Postgres also holds the conversations created
  // natively since the 2026-08-30 cutover (random ids, none in Mongo): they show up as extra, not as drift.
  { mongo: 'conversations', pg: 'conversation.conversations', lowerCase: true },
  { mongo: 'messages', pg: 'conversation.messages', lowerCase: true },
  { mongo: 'reports', pg: 'conversation.reports', lowerCase: true },
];

const ALL_PAIRS: KeyedPair[] = [
  ...PAIRS.map(([mongo, pg]) => ({ mongo, pg })),
  ...NEW_MODULE_PAIRS,
];

const OID_RE = /^[0-9a-f]{24}$/;

/** ms epoch encoded in an ObjectId, or null when the id is not one. */
function oidTimeMs(id: string): number | null {
  if (!OID_RE.test(id)) return null;
  return parseInt(id.slice(0, 8), 16) * 1000;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

interface PairReport {
  pair: [string, string];
  mongo: number;
  pg: number | null;
  missing: string[];
  extra: string[];
  /** Missing ids created after --since (drift = something still writes Mongo). */
  drift: string[];
  /** Creation instant (ms) of each missing id, when it can be derived. */
  createdMs: Map<string, number>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowArg = args.find((a) => a.startsWith('--allow='))?.slice(8) ?? null;
  const sinceArg = args.find((a) => a.startsWith('--since='))?.slice(8) ?? null;
  const strict = args.includes('--strict');

  const allowed = new Set<string>();
  if (allowArg) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(allowArg), 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) allowed.add(String(id));
    else for (const [id, reason] of Object.entries(raw)) {
      allowed.add(id);
      console.log(`allow: ${id} — ${reason}`);
    }
  }
  const sinceMs = sinceArg ? Date.parse(sinceArg) : null;
  if (sinceArg && Number.isNaN(sinceMs)) throw new Error(`--since: cannot parse ${sinceArg}`);

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 2,
    options: '-c default_transaction_read_only=on',
  });

  const reports: PairReport[] = [];
  for (const { mongo: mongoName, pg: pgTable, mongoKey, pgKey, lowerCase } of ALL_PAIRS) {
    const norm = (v: unknown): string => (lowerCase ? String(v).toLowerCase() : String(v));
    const mongoIds: string[] = [];
    // A business id (bindingId, toolCallId…) carries no ObjectId timestamp: --since falls back to createdAt.
    const createdMs = new Map<string, number>();
    const projection = mongoKey ? { [mongoKey]: 1, createdAt: 1 } : { _id: 1 };
    for await (const doc of mdb.collection(mongoName).find({}, { projection })) {
      const id = norm(mongoKey ? (doc[mongoKey] ?? doc._id) : doc._id);
      mongoIds.push(id);
      const created: unknown = doc.createdAt;
      if (mongoKey && created instanceof Date) createdMs.set(id, created.getTime());
    }
    let pgIds: string[] | null = null;
    try {
      const r = await pool.query(`SELECT ${pgKey ?? 'id'} AS id FROM ${pgTable}`);
      pgIds = r.rows.map((row) => norm(row.id));
    } catch {
      console.log(`!! ${pgTable} does not exist — skipping pair`);
    }

    const pgSet = new Set(pgIds ?? []);
    const missing: string[] = [];
    const extra: string[] = [];
    const drift: string[] = [];
    const missingMs = new Map<string, number>();
    for (const id of mongoIds) {
      if (pgSet.has(id) || allowed.has(id)) continue;
      missing.push(id);
      const t = oidTimeMs(id) ?? createdMs.get(id) ?? null;
      if (t !== null) missingMs.set(id, t);
      if (sinceMs !== null && t !== null && t >= sinceMs) drift.push(id);
    }
    const mongoSet = new Set(mongoIds);
    for (const id of pgSet) if (!mongoSet.has(id)) extra.push(id);

    reports.push({ pair: [mongoName, pgTable], mongo: mongoIds.length, pg: pgIds ? pgIds.length : null, missing, extra, drift, createdMs: missingMs });
  }

  await mongoose.disconnect();
  await pool.end();

  let missingTotal = 0;
  let driftTotal = 0;
  let extraTotal = 0;
  for (const r of reports) {
    missingTotal += r.missing.length;
    driftTotal += r.drift.length;
    extraTotal += r.extra.length;
    const flag = r.drift.length ? 'DRIFT' : r.missing.length ? 'missing' : 'ok';
    console.log(`[${flag.padEnd(7)}] ${r.pair[0]} → ${r.pair[1]}: mongo=${r.mongo} pg=${r.pg ?? '?'} missing=${r.missing.length} extra=${r.extra.length}`);
    for (const id of r.missing.slice(0, 10)) {
      const t = r.createdMs.get(id);
      console.log(`    missing ${id}${t ? ` (created ${fmtTime(t)})` : ''}${r.drift.includes(id) ? ' [drift: after --since]' : ''}`);
    }
    if (r.missing.length > 10) console.log(`    … and ${r.missing.length - 10} more`);
  }

  console.log('=== summary ===');
  console.log(JSON.stringify({ pairs: reports.length, missingTotal, extraTotal, driftTotal, since: sinceArg, allowedIds: allowed.size }, null, 2));

  if (strict && (missingTotal > allowed.size || driftTotal > 0)) {
    console.log('STRICT: reconciliation failed');
    process.exitCode = 1;
  } else if (strict) {
    console.log('STRICT: ok');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
