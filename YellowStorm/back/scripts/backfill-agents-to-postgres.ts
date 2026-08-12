/**
 * One-time backfill: copy every Mongo `agents` document into Postgres.
 *
 * Idempotent & safe:
 *   - Only READS from Mongo; never mutates or deletes source data.
 *   - Skips any agent whose id already exists in Postgres, so re-running is a no-op
 *     for already-migrated rows (never duplicates, never overwrites).
 *   - Each agent is migrated independently: a single bad document is recorded and
 *     skipped instead of aborting the whole run.
 *
 * Usage:
 *   npx ts-node back/scripts/backfill-agents-to-postgres.ts [flags]
 *
 * Flags:
 *   --dry-run            Read + validate everything, but write nothing to Postgres.
 *   --batch-size=N       Mongo cursor / verify batch size (default 200).
 *   --verify             After migrating, re-read each agent from Postgres and
 *                        compare it against Mongo (scalars + junction sets).
 *                        Combine with --dry-run to verify a previous run.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/modules/postgres/schema';
import { AgentRepository, CreateAgentInput } from '../src/modules/agent/repositories/agent.repository';
import type { AgentRecord } from '../src/modules/agent/repositories/agent-record.mapper';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error('MONGODB_URI is required');
const dryRun = process.argv.includes('--dry-run');
const verify = process.argv.includes('--verify');
const batchSize = Number(process.argv.find((v) => v.startsWith('--batch-size='))?.split('=')[1] ?? '200');

const idStr = (v: unknown): string => (v == null ? '' : String(v));
const idArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(idStr).filter(Boolean) : []);

type MongoDoc = Record<string, unknown>;

/** Map a raw Mongo agent document to the repository's CreateAgentInput shape. */
function buildInput(doc: MongoDoc, typeSlug: Map<string, string>): CreateAgentInput {
  const agentTypeId = idStr(doc.agentType);
  return {
    id: idStr(doc._id),
    name: idStr(doc.name),
    slug: idStr(doc.slug),
    agentType: agentTypeId,
    agentTypeSlug: typeSlug.get(agentTypeId) ?? '',
    role: idStr(doc.role),
    description: idStr(doc.description ?? ''),
    temperature: Number(doc.temperature ?? 0),
    llmModel: doc.llmModel ? idStr(doc.llmModel) : undefined,
    email: doc.email ? idStr(doc.email) : undefined,
    instruction: idStr(doc.instruction ?? ''),
    ignorePrePrompt: Boolean(doc.ignorePrePrompt),
    knowledgeBases: idArr(doc.knowledgeBases),
    tools: idArr(doc.tools),
    skills: idArr(doc.skills),
    disabledSkills: idArr(doc.disabledSkills),
    connectors: idArr(doc.connectors),
    connectorActionSelections: Array.isArray(doc.connectorActionSelections)
      ? (doc.connectorActionSelections as Record<string, unknown>[]).map((s) => ({
          connectorId: idStr(s.connector),
          actionKeys: Array.isArray(s.actionKeys) ? s.actionKeys.map(String) : [],
        }))
      : [],
    guardrails: (doc.guardrails as Record<string, unknown>) ?? {},
    deploymentSettings: (doc.deploymentSettings as Record<string, unknown>) ?? {},
    enable_temporary_child_agents: Boolean(doc.enable_temporary_child_agents),
    max_temporary_child_agents: Number(doc.max_temporary_child_agents ?? 4),
    isDefault: Boolean(doc.isDefault),
    isActive: doc.isActive === undefined ? true : Boolean(doc.isActive),
    isDefaultForType: Boolean(doc.isDefaultForType),
    createdBy: idStr(doc.createdBy),
    a2aPublished: Boolean(doc.a2aPublished),
    a2aAgentId: doc.a2aAgentId ? idStr(doc.a2aAgentId) : null,
    a2aAgentCardUrl: doc.a2aAgentCardUrl ? idStr(doc.a2aAgentCardUrl) : null,
    a2aApiKeyHeader: doc.a2aApiKeyHeader ? idStr(doc.a2aApiKeyHeader) : null,
    a2aPublishedAt: doc.a2aPublishedAt ? new Date(doc.a2aPublishedAt as string) : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt as string) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string) : undefined,
  };
}

/** Required fields without which a row cannot be safely inserted. Returns a reason or null. */
function validationError(input: CreateAgentInput): string | null {
  if (!input.id) return 'missing _id';
  if (!input.name) return 'missing name';
  if (!input.role) return 'missing role';
  if (!input.agentType) return 'missing agentType';
  if (!input.createdBy) return 'missing createdBy';
  return null;
}

function sortedSet(v: string[]): string[] {
  return [...new Set(v)].sort();
}
function sameSet(a: string[], b: string[]): boolean {
  const x = sortedSet(a), y = sortedSet(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
function connActionsKey(sel: Array<{ connector: string; actionKeys: string[] }>): string {
  return JSON.stringify(
    sel
      .map((s) => [s.connector, sortedSet(s.actionKeys)] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

/** Compare a Postgres record against the source Mongo input. Returns list of mismatched fields. */
function diffFields(input: CreateAgentInput, rec: AgentRecord): string[] {
  const bad: string[] = [];
  const scalar: Array<[string, unknown, unknown]> = [
    ['name', input.name, rec.name],
    ['slug', input.slug, rec.slug],
    ['agentType', input.agentType, rec.agentType],
    ['role', input.role, rec.role],
    ['description', input.description, rec.description],
    ['temperature', input.temperature, rec.temperature],
    ['instruction', input.instruction, rec.instruction],
    ['ignorePrePrompt', input.ignorePrePrompt, rec.ignorePrePrompt],
    ['isDefault', input.isDefault, rec.isDefault],
    ['isActive', input.isActive, rec.isActive],
    ['isDefaultForType', input.isDefaultForType, rec.isDefaultForType],
    ['createdBy', input.createdBy, rec.createdBy],
    ['enable_temporary_child_agents', input.enable_temporary_child_agents, rec.enable_temporary_child_agents],
    ['max_temporary_child_agents', input.max_temporary_child_agents, rec.max_temporary_child_agents],
  ];
  for (const [field, a, b] of scalar) if (a !== b) bad.push(field);

  if (!sameSet(input.tools, rec.tools)) bad.push('tools');
  if (!sameSet(input.skills, rec.skills)) bad.push('skills');
  if (!sameSet(input.disabledSkills, rec.disabledSkills)) bad.push('disabledSkills');
  if (!sameSet(input.connectors, rec.connectors)) bad.push('connectors');
  if (!sameSet(input.knowledgeBases, rec.knowledgeBases)) bad.push('knowledgeBases');

  const inputSel = input.connectorActionSelections.map((s) => ({ connector: s.connectorId, actionKeys: s.actionKeys }));
  if (connActionsKey(inputSel) !== connActionsKey(rec.connectorActionSelections)) bad.push('connectorActionSelections');

  return bad;
}

async function main(): Promise<void> {
  await mongoose.connect(mongoUri!);
  const mdb = mongoose.connection.db!;
  const agentsCol = mdb.collection('agents');
  const typesCol = mdb.collection('agent_types');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 4,
  });
  const db = drizzle(pool, { schema });
  const repo = new AgentRepository(db as never);

  // Cache agent-type slugs.
  const typeSlug = new Map<string, string>();
  for await (const t of typesCol.find({})) typeSlug.set(idStr(t._id), idStr(t.slug));

  let processed = 0, skipped = 0, inserted = 0, orphanTypes = 0;
  const failures: Array<{ id: string; name: string; reason: string }> = [];

  for await (const doc of agentsCol.find({}).batchSize(batchSize)) {
    processed += 1;
    const input = buildInput(doc as MongoDoc, typeSlug);

    const reason = validationError(input);
    if (reason) {
      failures.push({ id: input.id || '(no id)', name: input.name || '(no name)', reason });
      continue;
    }
    if (!input.agentTypeSlug) orphanTypes += 1;

    try {
      const existing = await db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(inArray(schema.agents.id, [input.id]));
      if (existing.length) { skipped += 1; continue; }

      if (!dryRun) { await repo.create(input); inserted += 1; }
    } catch (e) {
      failures.push({ id: input.id, name: input.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log('=== migration ===');
  console.log(JSON.stringify({ dryRun, processed, skipped, inserted, orphanTypes, failed: failures.length }, null, 2));
  if (failures.length) {
    console.log('--- failures ---');
    for (const f of failures) console.log(`  ${f.id} (${f.name}): ${f.reason}`);
  }

  if (verify) await runVerify(agentsCol, typeSlug, repo);

  await pool.end();
  await mongoose.disconnect();

  if (failures.length) process.exitCode = 1;
}

/** Re-read every Mongo agent from Postgres and report missing rows or field mismatches. */
async function runVerify(
  agentsCol: mongoose.mongo.Collection,
  typeSlug: Map<string, string>,
  repo: AgentRepository,
): Promise<void> {
  let checked = 0, missing = 0, mismatched = 0;
  const problems: Array<{ id: string; name: string; issue: string }> = [];

  let batch: CreateAgentInput[] = [];
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const recs = await repo.findByIds(batch.map((b) => b.id));
    const byId = new Map(recs.map((r) => [r._id, r]));
    for (const input of batch) {
      checked += 1;
      const rec = byId.get(input.id);
      if (!rec) { missing += 1; problems.push({ id: input.id, name: input.name, issue: 'missing in Postgres' }); continue; }
      const bad = diffFields(input, rec);
      if (bad.length) { mismatched += 1; problems.push({ id: input.id, name: input.name, issue: `mismatch: ${bad.join(', ')}` }); }
    }
    batch = [];
  };

  for await (const doc of agentsCol.find({}).batchSize(batchSize)) {
    const input = buildInput(doc as MongoDoc, typeSlug);
    if (!input.id) continue;
    batch.push(input);
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  console.log('=== verify ===');
  console.log(JSON.stringify({ checked, missing, mismatched }, null, 2));
  if (problems.length) {
    console.log('--- problems ---');
    for (const p of problems) console.log(`  ${p.id} (${p.name}): ${p.issue}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
