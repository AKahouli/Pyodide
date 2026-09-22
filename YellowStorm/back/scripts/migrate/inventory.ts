/**
 * Step 0.3 — read-only Mongo inventory for the PostgreSQL migration.
 *
 * Extends the previous (workspace/project/governance) report with the 43
 * P1A/P1B/P3/P4 collections, their structural orphan edges, and the
 * duplicate/invariant counts that set backfill batch sizes (see the plan
 * appendix). Edges targeting already-migrated Postgres tables (public.agents,
 * conversation.conversations) are checked against PG when POSTGRES_HOST is
 * set, and skipped with a warning otherwise.
 *
 * Usage: npx ts-node back/scripts/migrate/inventory.ts
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { reportOrphans, type OrphanEdge } from './orphans';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const PREVIOUS_PHASE = [
  'projects',
  'project-shares',
  'workspace_artifacts',
  'workspaces',
  'workspace_settings',
  'workspace_documents',
  'workspace-shares',
  'upload_sessions',
  'governance_programs',
  'governance_scopes',
  'governance_documents',
  'governance_document_events',
  'governance_workspace_bindings',
  'governance_reconciliation_runs',
  'governance_memberships',
  'governance_deployments',
  'governance_deployment_revisions',
  'governance_dry_runs',
  'governance_metrics',
  'governance_publication_attempts',
];

const IN_SCOPE = [
  // P1A — identity / authz
  'users',
  'sessions',
  'auth_providers',
  'oauth_states',
  'provider_link_tokens',
  'user_provider_links',
  'roles',
  'audit_logs',
  'user_groups',
  // P1B — catalog / ops
  'notifications',
  'health_history',
  'system_settings',
  'appearance_logos',
  'models',
  'guardrails_settings',
  'plans',
  'tools',
  'tool_categories',
  'skills',
  'skill_categories',
  'agent_types',
  'agent_type_prompts',
  // P3 — integrations
  'connected_app_definitions',
  'user_app_connections',
  'connected_app_oauth_states',
  'connectors',
  'connector_categories',
  'connector_credentials',
  'admin_connector_auth_tokens',
  'admin_connector_oauth_states',
  // P4 — agent ecosystem
  'shared_agents',
  'teams',
  'shared_teams',
  'team_auto_builder_config',
  'agent_telegram_integrations',
  'telegram_chat_bindings',
  'telegram_link_codes',
  'agent_whatsapp_integrations',
  'whatsapp_auth_sessions',
  'whatsapp_chat_bindings',
  'widget_tokens',
  'widget_sessions',
  'widget_messages',
  // P8 — conversation v2
  'conversation_v2_sessions',
  'conversation_v2_events',
  'conversation_v2_app_shares',
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  const mdb = mongoose.connection.db!;
  const col = (name: string): mongoose.mongo.Collection => mdb.collection(name);

  console.log('=== document counts ===');
  const counts: Record<string, number> = {};
  for (const name of [...PREVIOUS_PHASE, ...IN_SCOPE]) {
    counts[name] = await col(name).countDocuments();
  }
  console.log(JSON.stringify(counts, null, 2));

  // ---- reference targets -------------------------------------------------
  const idSet = async (name: string): Promise<Set<string>> =>
    new Set((await col(name).find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));

  const [
    workspaceIds, documentIds, projectIds,
    roleIds, planIds, userIds, agentTypeIds, skillIds,
    toolCategoryIds, skillCategoryIds, connectorCategoryIds, connectorIds,
    teamIds, telegramIntegrationIds, whatsappIntegrationIds,
    workyWhatsappIds, workySystemBotIds,
  ] = await Promise.all([
    idSet('workspaces'), idSet('workspace_documents'), idSet('projects'),
    idSet('roles'), idSet('plans'), idSet('users'), idSet('agent_types'), idSet('skills'),
    idSet('tool_categories'), idSet('skill_categories'), idSet('connector_categories'), idSet('connectors'),
    idSet('teams'), idSet('agent_telegram_integrations'), idSet('agent_whatsapp_integrations'),
    idSet('worky_whatsapp_integrations'), idSet('worky_whatsapp_system_bot'),
  ]);

  let pgAgents: Set<string> | null = null;
  let pgConversations: Set<string> | null = null;
  if (process.env.POSTGRES_HOST) {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    pgAgents = new Set((await pool.query('SELECT id FROM public.agents')).rows.map((r) => String(r.id)));
    pgConversations = new Set(
      (await pool.query('SELECT id FROM conversation.conversations')).rows.map((r) => String(r.id)),
    );
    await pool.end();
  } else {
    console.warn('POSTGRES_HOST not set — PG-backed orphan edges (agents, conversations) skipped');
  }

  const among = (target: Set<string>) => async (ids: string[]): Promise<Set<string>> =>
    new Set(ids.filter((id) => target.has(id)));
  const union = (...sets: Set<string>[]): Set<string> => new Set(sets.flatMap((s) => [...s]));

  type Edge = OrphanEdge & { source: string };
  const edges: Edge[] = [
    // previous phase
    { source: 'project-shares', label: 'project-shares.projectId → projects', path: 'projectId', exists: among(projectIds) },
    { source: 'workspace_artifacts', label: 'workspace_artifacts.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_artifacts', label: 'workspace_artifacts.primarySource.documentId → workspace_documents', path: 'primarySource.documentId', exists: among(documentIds) },
    { source: 'workspace-shares', label: 'workspace-shares.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_documents', label: 'workspace_documents.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_documents', label: 'workspace_documents.parentId → workspace_documents', path: 'parentId', exists: among(documentIds) },
    { source: 'governance_documents', label: 'governance_documents.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'governance_documents', label: 'governance_documents.documentId → workspace_documents', path: 'documentId', exists: among(documentIds) },
    // P1A
    { source: 'users', label: 'users.roles[] → roles', path: 'roles', exists: among(roleIds) },
    { source: 'users', label: 'users.planId → plans', path: 'planId', exists: among(planIds) },
    { source: 'user_groups', label: 'user_groups.members[] → users', path: 'members', exists: among(userIds) },
    { source: 'sessions', label: 'sessions.userId → users', path: 'userId', exists: among(userIds) },
    { source: 'user_provider_links', label: 'user_provider_links.userId → users', path: 'userId', exists: among(userIds) },
    // P1B
    { source: 'agent_type_prompts', label: 'agent_type_prompts.agentType → agent_types', path: 'agentType', exists: among(agentTypeIds) },
    { source: 'agent_types', label: 'agent_types.skills[] → skills', path: 'skills', exists: among(skillIds) },
    { source: 'tools', label: 'tools.categoryId → tool_categories', path: 'categoryId', exists: among(toolCategoryIds) },
    { source: 'skills', label: 'skills.categoryId → skill_categories', path: 'categoryId', exists: among(skillCategoryIds) },
    // P3
    { source: 'connectors', label: 'connectors.categoryId → connector_categories', path: 'categoryId', exists: among(connectorCategoryIds) },
    { source: 'connectors', label: 'connectors.referencedSkillIds[] → skills', path: 'referencedSkillIds', exists: among(skillIds) },
    { source: 'connector_credentials', label: 'connector_credentials.connectorId → connectors', path: 'connectorId', exists: among(connectorIds) },
    // P4
    { source: 'shared_agents', label: 'shared_agents.agentId → PG public.agents', path: 'agentId', exists: among(pgAgents ?? new Set()) },
    { source: 'teams', label: 'teams.members[].agentId → PG public.agents', path: 'members.agentId', exists: among(pgAgents ?? new Set()) },
    { source: 'teams', label: 'teams.members[].parentAgentId → PG public.agents', path: 'members.parentAgentId', exists: among(pgAgents ?? new Set()) },
    { source: 'shared_teams', label: 'shared_teams.teamId → teams', path: 'teamId', exists: among(teamIds) },
    { source: 'agent_telegram_integrations', label: 'agent_telegram_integrations.agentId → PG public.agents', path: 'agentId', exists: among(pgAgents ?? new Set()) },
    { source: 'agent_whatsapp_integrations', label: 'agent_whatsapp_integrations.agentId → PG public.agents', path: 'agentId', exists: among(pgAgents ?? new Set()) },
    { source: 'widget_tokens', label: 'widget_tokens.agentId → PG public.agents', path: 'agentId', exists: among(pgAgents ?? new Set()) },
    { source: 'telegram_chat_bindings', label: 'telegram_chat_bindings.integrationId → agent_telegram_integrations', path: 'integrationId', exists: among(telegramIntegrationIds) },
    {
      source: 'whatsapp_chat_bindings',
      label: 'whatsapp_chat_bindings.integrationId → agent|worky whatsapp integrations (polymorphic)',
      path: 'integrationId',
      exists: among(union(whatsappIntegrationIds, workyWhatsappIds, workySystemBotIds)),
    },
  ];
  if (pgConversations) {
    edges.push(
      { source: 'telegram_chat_bindings', label: 'telegram_chat_bindings.conversationId → PG conversation.conversations', path: 'conversationId', exists: among(pgConversations) },
      { source: 'whatsapp_chat_bindings', label: 'whatsapp_chat_bindings.conversationId → PG conversation.conversations', path: 'conversationId', exists: among(pgConversations) },
    );
  }

  console.log('=== orphan counts (structural refs) ===');
  const bySource = new Map<string, OrphanEdge[]>();
  for (const { source, ...edge } of edges) {
    bySource.set(source, [...(bySource.get(source) ?? []), edge]);
  }
  for (const [source, sourceEdges] of bySource) {
    const report = await reportOrphans(col(source), sourceEdges);
    for (const item of report) {
      console.log(JSON.stringify({ edge: item.label, orphanDocs: item.orphanDocs, sample: item.sample }));
    }
  }

  console.log('=== duplicates / invariants ===');
  const reportDup = async (label: string, rows: unknown[]): Promise<void> =>
    console.log(JSON.stringify({ label, count: rows.length, sample: rows.slice(0, 10) }));

  await reportDup('users duplicate lower(email)', await col('users').aggregate([
    { $group: { _id: { email: { $toLower: '$email' } }, n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray());

  await reportDup('user_groups duplicate (name, createdBy)', await col('user_groups').aggregate([
    { $group: { _id: { name: '$name', createdBy: '$createdBy' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray());

  const defaults = {
    modelsIsDefault: await col('models').countDocuments({ isDefault: true }),
    modelsIsConversationV2Default: await col('models').countDocuments({ isConversationV2Default: true }),
    plansIsDefault: await col('plans').countDocuments({ isDefault: true }),
  };
  console.log(JSON.stringify({ label: 'multiple defaults (each must be 0 or 1)', ...defaults }));

  await reportDup('teams duplicate members.agentId within one team', await col('teams').aggregate([
    { $unwind: '$members' },
    { $group: { _id: { team: '$_id', agent: '$members.agentId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray());

  await reportDup('connectors duplicate actions.key within one connector', await col('connectors').aggregate([
    { $unwind: '$actions' },
    { $group: { _id: { connector: '$_id', key: '$actions.key' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray());

  console.log(JSON.stringify({
    label: 'skills with slug missing',
    count: await col('skills').countDocuments({ $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] }),
  }));

  console.log(JSON.stringify({
    label: 'audit_logs older than 730 days (sweeper would remove)',
    count: await col('audit_logs').countDocuments({ createdAt: { $lt: new Date(Date.now() - 730 * 86_400_000) } }),
  }));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
