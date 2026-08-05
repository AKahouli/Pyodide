/**
 * Live smoke test: exercise AgentRepository against the real Postgres.
 * Reads the migrated agents from `agentstore`; write round-trip on `agentstore_test`.
 * Usage: npx ts-node back/scripts/smoke-agent-repo.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Types } from 'mongoose';
import * as schema from '../src/modules/postgres/schema';
import { AgentRepository } from '../src/modules/agent/repositories/agent.repository';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function makeRepo(database: string) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
  });
  const db = drizzle(pool, { schema });
  return { repo: new AgentRepository(db as never), pool };
}

async function main(): Promise<void> {
  // --- READ path against the real migrated data (agentstore) ---
  const read = makeRepo(process.env.POSTGRES_DB || 'agentstore');
  const defaults = await read.repo.findActiveDefaults();
  console.log(`[read] active default agents in ${process.env.POSTGRES_DB}: ${defaults.length}`);
  if (defaults.length) {
    const a = defaults[0];
    const byId = await read.repo.findById(a._id);
    console.log('[read] sample agent:', JSON.stringify({
      id: a._id, name: a.name, agentType: a.agentType, agentTypeSlug: a.agentTypeSlug,
      tools: a.tools.length, skills: a.skills.length, connectors: a.connectors.length,
      isDefault: a.isDefault, roundtripOk: byId?._id === a._id,
    }));
  }
  await read.pool.end();

  // --- WRITE round-trip against the disposable test DB ---
  const write = makeRepo(process.env.POSTGRES_TEST_DB || 'agentstore_test');
  const id = new Types.ObjectId().toString();
  const toolId = new Types.ObjectId().toString();
  const created = await write.repo.create({
    id, name: `smoke-${id.slice(-6)}`, slug: `smoke-${id.slice(-6)}`,
    agentType: new Types.ObjectId().toString(), agentTypeSlug: 'mono-agent',
    role: 'smoke', description: '', temperature: 0, instruction: '', ignorePrePrompt: false,
    knowledgeBases: [], tools: [toolId], skills: [], disabledSkills: [], connectors: [],
    connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
    enable_temporary_child_agents: false, max_temporary_child_agents: 4,
    isDefault: false, isActive: true, isDefaultForType: false,
    createdBy: new Types.ObjectId().toString(),
  });
  const updated = await write.repo.updateById(id, { description: 'updated', tools: [] });
  const afterDelete = await (async () => { await write.repo.deleteById(id); return write.repo.findById(id); })();
  console.log('[write] round-trip:', JSON.stringify({
    created: created._id === id && created.tools.length === 1,
    updatedDescription: updated?.description === 'updated',
    junctionDiffCleared: updated?.tools.length === 0,
    deleted: afterDelete === null,
  }));
  await write.pool.end();

  console.log('SMOKE OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
