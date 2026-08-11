/**
 * One-time backfill: copy every Mongo `agents` document into Postgres.
 * Usage: npx ts-node back/scripts/backfill-agents-to-postgres.ts --dry-run
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/modules/postgres/schema';
import { AgentRepository, CreateAgentInput } from '../src/modules/agent/repositories/agent.repository';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error('MONGODB_URI is required');
const dryRun = process.argv.includes('--dry-run');
const batchSize = Number(process.argv.find((v) => v.startsWith('--batch-size='))?.split('=')[1] ?? '200');

const idStr = (v: unknown): string => (v == null ? '' : String(v));
const idArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(idStr).filter(Boolean) : []);

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
  for await (const doc of agentsCol.find({}).batchSize(batchSize)) {
    processed += 1;
    const id = idStr(doc._id);
    const existing = await db.select({ id: schema.agents.id }).from(schema.agents).where(inArray(schema.agents.id, [id]));
    if (existing.length) { skipped += 1; continue; }

    const agentTypeId = idStr(doc.agentType);
    const slug = typeSlug.get(agentTypeId) ?? '';
    if (!slug) orphanTypes += 1;

    const input: CreateAgentInput = {
      id,
      name: idStr(doc.name),
      slug: idStr(doc.slug),
      agentType: agentTypeId,
      agentTypeSlug: slug,
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
        ? doc.connectorActionSelections.map((s: Record<string, unknown>) => ({
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

    if (!dryRun) { await repo.create(input); inserted += 1; }
  }

  console.log(JSON.stringify({ dryRun, processed, skipped, inserted, orphanTypes }, null, 2));
  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
