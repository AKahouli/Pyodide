/**
 * One-time backfill: compute role_embedding for existing humain agents.
 * Usage: npx ts-node back/scripts/backfill-humain-role-embeddings.ts [--dry-run] [--all]
 *   --dry-run : count only, no embedding/writes
 *   --all     : re-embed every humain agent (default: only those missing an embedding)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import axios from 'axios';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const reembedAll = process.argv.includes('--all');

function embeddingDimension(): number {
  const dimensions = Number(process.env.EMBEDDING_DIMENSION || '2560');
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('EMBEDDING_DIMENSION must be a positive integer');
  }
  return dimensions;
}

async function embed(text: string): Promise<number[] | null> {
  const base = (process.env.LITELLM_API_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('LITELLM_API_URL is required');
  const model = process.env.EMBEDDING_MODEL || 'qwen3-embedding';
  const dimensions = embeddingDimension();
  const res = await axios.post(
    `${base}/v1/embeddings`,
    { model, input: text },
    { headers: { Authorization: `Bearer ${process.env.LITELLM_API_KEY || ''}` }, timeout: 30000 },
  );
  const vec = res.data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== dimensions || !vec.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`LiteLLM returned an invalid embedding vector (expected ${dimensions} dimensions)`);
  }
  return vec;
}

async function main(): Promise<void> {
  embeddingDimension();
  if (!dryRun) {
    await embed('Embedding compatibility check');
  }
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const where = reembedAll
    ? `agent_type_slug = 'humain'`
    : `agent_type_slug = 'humain' AND role_embedding IS NULL`;
  const rows = (await pool.query(`SELECT id, name, role FROM agents WHERE ${where}`)).rows as Array<{ id: string; name: string; role: string }>;

  let processed = 0, embedded = 0, failed = 0;
  for (const r of rows) {
    processed += 1;
    if (dryRun) continue;
    try {
      const vec = await embed(`${r.name}. ${r.role}`);
      if (!vec) { failed += 1; continue; }
      await pool.query('UPDATE agents SET role_embedding = $1::halfvec WHERE id = $2', [`[${vec.join(',')}]`, r.id]);
      embedded += 1;
    } catch (e) {
      failed += 1;
      console.error('embed failed for', String(r.id).trim(), (e as Error).message);
    }
  }

  console.log(JSON.stringify({ dryRun, reembedAll, candidates: rows.length, processed, embedded, failed }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
