/**
 * Step E backfill: Mongo governance_* collections → Postgres `governance` schema.
 * Order (plan E.11): programs → scopes (+3 child tables) → workspace bindings (+binding
 * scopes) → documents → document events → memberships → deployments → revisions →
 * dry runs → publication attempts → metrics → reconciliation runs.
 *
 * Idempotent via ON CONFLICT (id) DO NOTHING. Rows whose intra-governance parents are
 * missing are skipped and reported (the DDL FKs would reject them). Cross-schema
 * references (workspaces, workspace_documents, agents, users) are reported as orphan
 * counts only — their FKs arrive with the service migration (E.13).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-governance.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;

const dryRun = process.argv.includes('--dry-run');

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// text[] columns receive JS arrays natively; jsonb columns get JSON.stringify.
const ARRAY_COLUMNS = new Set([
  'knowledge_web_allowed_domains', 'knowledge_web_blocked_domains', 'tags', 'permissions',
  'requested_channels', 'allowed_agent_ids', 'workspace_ids',
]);

async function insertRow(pool: Pool, table: string, row: Row): Promise<void> {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined && !k.startsWith('__'));
  if (keys.length === 0) return;
  const cols = keys.map((k) => `"${snake(k)}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => {
    const v = row[k];
    if (ARRAY_COLUMNS.has(snake(k))) return v;
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  // No conflict target: child tables have composite PKs, parents have id.
  await pool.query(`INSERT INTO governance."${table}" (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
}

const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const d = (v: unknown): Date | undefined => (v == null ? undefined : v instanceof Date ? v : new Date(String(v)));

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 2,
  });

  const summary: Record<string, { mongo: number; inserted: number; skippedOrphan: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idSet = async (table: string): Promise<Set<string>> =>
    new Set((await pool.query(`SELECT id FROM governance."${table}"`)).rows.map((r) => r.id));

  const runCollection = async (
    label: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: (doc: any) => Row[],
    existingParents: Record<string, Set<string>> = {},
    parentChecks: Array<{ rowKey: string; parents: string[] }> = [],
  ): Promise<void> => {
    console.log(`=== ${label} ===`);
    const col = mdb.collection(label);
    const mongoCount = await col.countDocuments();
    let inserted = 0;
    let skippedOrphan = 0;
    for await (const doc of col.find({})) {
      // Parent checks: skip docs whose intra-governance parents did not migrate.
      let orphan = false;
      for (const check of parentChecks) {
        const value = check.rowKey.split('.').reduce<unknown>((acc, part) => (acc == null || typeof acc !== 'object' ? undefined : (acc as Record<string, unknown>)[part]), doc as unknown);
        if (value != null) {
          const id = String(value);
          const set = existingParents[check.parents[0]];
          if (set && !set.has(id)) orphan = true;
        }
      }
      if (orphan) {
        skippedOrphan += 1;
        continue;
      }
      const rows = build(doc);
      if (dryRun) {
        inserted += 1;
        continue;
      }
      try {
        for (const row of rows) await insertRow(pool, rowsTable(label, row), row);
        inserted += 1;
      } catch (error) {
        console.warn(`insert failed for ${String(doc._id)}: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`);
        skippedOrphan += 1;
      }
    }
    summary[label] = { mongo: mongoCount, inserted, skippedOrphan };
    console.log(JSON.stringify({ mongo: mongoCount, inserted, skippedOrphan }));
  };

  // helper: rows carry an optional __table override for child tables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsTable = (_label: string, row: Row & { __table?: string }): string => (row.__table as string) ?? _label;

  // ---- 1. programs ----
  await runCollection('governance_programs', (doc) => [
    {
      id: String(doc._id),
      name: String(doc.name ?? ''),
      description: s(doc.description),
      domain: s(doc.domain),
      default_language: s(doc.defaultLanguage) ?? 'fr',
      status: s(doc.status) ?? 'draft',
      owner_user_id: String(doc.ownerUserId ?? ''),
      metadata: doc.metadata ?? {},
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 2. scopes (+ child tables) ----
  await runCollection('governance_scopes', (doc) => {
    const id = String(doc._id);
    const rows: Row[] = [
      {
        __table: 'governance_scopes',
        id,
        program_id: String(doc.programId ?? ''),
        parent_scope_id: s(doc.parentScopeId),
        name: String(doc.name ?? ''),
        type: s(doc.type) ?? 'custom',
        status: s(doc.status) ?? 'active',
        audience_mode: s(doc.audience?.mode) ?? 'restricted',
        knowledge_source_mode: s(doc.knowledge?.sourceMode) ?? 'llm_only',
        knowledge_web_sources_enabled: Boolean(doc.knowledge?.webSourcesEnabled),
        knowledge_web_allowed_domains: doc.knowledge?.webAllowedDomains ?? [],
        knowledge_web_blocked_domains: doc.knowledge?.webBlockedDomains ?? [],
        metadata: doc.metadata ?? {},
        created_at: d(doc.createdAt),
        updated_at: d(doc.updatedAt),
      },
    ];
    for (const agentId of doc.agentIds ?? []) {
      rows.push({ __table: 'governance_scope_agents', scope_id: id, agent_id: String(agentId) });
    }
    for (const userId of doc.audience?.userIds ?? []) {
      rows.push({ __table: 'governance_scope_audience_users', scope_id: id, user_id: String(userId) });
    }
    for (const groupId of doc.audience?.groupIds ?? []) {
      rows.push({ __table: 'governance_scope_audience_groups', scope_id: id, group_id: String(groupId) });
    }
    return rows;
  });

  // ---- 3. workspace bindings (+ binding scopes) ----
  await runCollection('governance_workspace_bindings', (doc) => {
    const id = String(doc._id);
    const rows: Row[] = [
      {
        __table: 'governance_workspace_bindings',
        id,
        program_id: String(doc.programId ?? ''),
        workspace_id: String(doc.workspaceId ?? ''),
        visibility: String(doc.visibility ?? 'program_shared'),
        enabled: Boolean(doc.enabled),
        ingestion_mode: s(doc.ingestionMode) ?? 'assisted',
        defaults: doc.defaults ?? {},
        created_by: String(doc.createdBy ?? ''),
        created_at: d(doc.createdAt),
        updated_at: d(doc.updatedAt),
      },
    ];
    for (const scopeId of doc.scopeIds ?? []) {
      rows.push({ __table: 'governance_binding_scopes', binding_id: id, scope_id: String(scopeId) });
    }
    return rows;
  });

  // ---- 4. documents ----
  await runCollection('governance_documents', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      document_id: String(doc.documentId ?? ''),
      workspace_id: String(doc.workspaceId ?? ''),
      status: s(doc.status) ?? 'captured',
      validity: doc.validity ?? {},
      validity_next_review_at: d(doc.validity?.nextReviewAt),
      validity_business_status: s(doc.validity?.businessStatus),
      tags: doc.tags ?? [],
      metadata: doc.metadata ?? {},
      owner_user_id: s(doc.ownerUserId),
      owner_scope_id: s(doc.ownerScopeId),
      governance_revision: Number(doc.governanceRevision ?? 0),
      temporal_decision_revision: Number(doc.temporalDecisionRevision ?? 0),
      submitted_for_review_by: s(doc.submittedForReviewBy),
      submitted_for_review_at: d(doc.submittedForReviewAt),
      reviewed_by: s(doc.reviewedBy),
      reviewed_at: d(doc.reviewedAt),
      approved_by: s(doc.approvedBy),
      approved_at: d(doc.approvedAt),
      published_by: s(doc.publishedBy),
      published_at: d(doc.publishedAt),
      review_comment: s(doc.reviewComment),
      archived_at: d(doc.archivedAt),
      archived_by: s(doc.archivedBy),
      archive_reason: s(doc.archiveReason),
      last_integration_event_id: s(doc.lastIntegrationEventId),
      last_integration_event_at: d(doc.lastIntegrationEventAt),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 5. document events ----
  await runCollection('governance_document_events', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      governance_document_id: String(doc.governanceDocumentId ?? ''),
      document_id: String(doc.documentId ?? ''),
      event_type: String(doc.eventType ?? ''),
      actor_id: s(doc.actorId),
      actor_type: s(doc.actorType) ?? 'system',
      actor_email: s(doc.actorEmail),
      occurred_at: d(doc.occurredAt) ?? new Date(),
      reason: s(doc.reason),
      before: doc.before ?? null,
      after: doc.after ?? null,
      metadata: doc.metadata ?? {},
      correlation_id: s(doc.correlationId),
      causation_id: s(doc.causationId),
      deduplication_key: s(doc.deduplicationKey),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 6. memberships ----
  await runCollection('governance_memberships', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      scope_id: s(doc.scopeId),
      user_id: s(doc.userId),
      group_id: s(doc.groupId),
      invited_by: String(doc.invitedBy ?? ''),
      role: String(doc.role ?? 'scope_viewer'),
      status: s(doc.status) ?? 'active',
      permissions: doc.permissions ?? [],
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 7. deployments ----
  await runCollection('governance_deployments', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      scope_id: String(doc.scopeId ?? ''),
      name: String(doc.name ?? ''),
      status: s(doc.status) ?? 'draft',
      current_draft_revision_id: s(doc.currentDraftRevisionId),
      current_published_revision_id: s(doc.currentPublishedRevisionId),
      revision_sequence: Number(doc.revisionSequence ?? 0),
      channels: doc.channels ?? {},
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 8. deployment revisions ----
  await runCollection('governance_deployment_revisions', (doc) => [
    {
      id: String(doc._id),
      deployment_id: String(doc.deploymentId ?? ''),
      revision_number: Number(doc.revisionNumber ?? 1),
      status: s(doc.status) ?? 'draft',
      agent_id: s(doc.agentId),
      // ObjectId objects must be stringified: node-pg JSON-dumps unknown object
      // elements inside array literals, overflowing char(24)[].
      allowed_agent_ids: (doc.allowedAgentIds ?? []).map((v: unknown) => String(v)),
      workspace_ids: (doc.workspaceIds ?? []).map((v: unknown) => String(v)),
      agent_snapshot: doc.agentSnapshot ?? {},
      workspace_binding_snapshot: doc.workspaceBindingSnapshot ?? {},
      channel_snapshot: doc.channelSnapshot ?? {},
      scope_snapshot: doc.scopeSnapshot ?? {},
      audience_snapshot: doc.audienceSnapshot ?? {},
      previous_audience_snapshot: doc.previousAudienceSnapshot ?? {},
      configuration_fingerprint: s(doc.configurationFingerprint),
      created_by: String(doc.createdBy ?? ''),
      approved_by: s(doc.approvedBy),
      published_by: s(doc.publishedBy),
      published_at: d(doc.publishedAt),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 9. dry runs ----
  await runCollection('governance_dry_runs', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      scope_id: String(doc.scopeId ?? ''),
      deployment_id: String(doc.deploymentId ?? ''),
      revision_id: String(doc.revisionId ?? ''),
      conversation_id: s(doc.conversationId),
      tester_id: String(doc.testerId ?? ''),
      status: s(doc.status) ?? 'running',
      execution_mode: s(doc.executionMode) ?? 'conversation',
      test_cases: doc.testCases ?? [],
      checks: doc.checks ?? {},
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 10. publication attempts ----
  await runCollection('governance_publication_attempts', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      scope_id: String(doc.scopeId ?? ''),
      deployment_id: String(doc.deploymentId ?? ''),
      revision_id: s(doc.revisionId),
      triggered_by_user_id: String(doc.triggeredByUserId ?? ''),
      triggered_by_email: String(doc.triggeredByEmail ?? ''),
      requested_channels: doc.requestedChannels ?? [],
      allow_partial: Boolean(doc.allowPartial),
      comment: s(doc.comment),
      status: String(doc.status ?? 'failed'),
      readiness_snapshot: doc.readinessSnapshot ?? {},
      error_code: s(doc.errorCode),
      error_message: s(doc.errorMessage),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 11. metrics ----
  await runCollection('governance_metrics', (doc) => [
    {
      id: String(doc._id),
      program_id: String(doc.programId ?? ''),
      scope_id: s(doc.scopeId),
      deployment_id: s(doc.deploymentId),
      agent_id: s(doc.agentId),
      channel: s(doc.channel),
      type: String(doc.type ?? ''),
      value: Number(doc.value ?? 0),
      dimensions: doc.dimensions ?? {},
      period_start: d(doc.periodStart) ?? new Date(0),
      period_end: d(doc.periodEnd) ?? new Date(0),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- 12. reconciliation runs ----
  await runCollection('governance_reconciliation_runs', (doc) => [
    {
      id: String(doc._id),
      binding_id: String(doc.bindingId ?? ''),
      status: s(doc.status) ?? 'pending',
      dry_run: Boolean(doc.dryRun),
      cursor: s(doc.cursor),
      stats: doc.stats ?? {},
      errors: doc.errors ?? [],
      started_at: d(doc.startedAt),
      completed_at: d(doc.completedAt),
      lease_token: s(doc.leaseToken),
      lease_expires_at: d(doc.leaseExpiresAt),
      created_at: d(doc.createdAt),
      updated_at: d(doc.updatedAt),
    },
  ]);

  // ---- summary ----
  console.log('=== governance backfill summary ===');
  const totals: Record<string, { mongo: number; inserted: number; pg: number; skippedOrphan: number }> = {};
  for (const [label, stat] of Object.entries(summary)) {
    const pg = (await pool.query(`SELECT count(*)::int AS n FROM governance."${label}"`)).rows[0].n;
    totals[label] = { mongo: stat.mongo, inserted: stat.inserted, pg, skippedOrphan: stat.skippedOrphan };
  }
  console.log(JSON.stringify(totals, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
