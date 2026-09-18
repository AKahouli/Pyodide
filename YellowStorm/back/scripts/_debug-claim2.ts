import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '../src/modules/postgres/schema';
import { PostgresWorkspaceArtifactStore } from '../src/modules/workspace-artifact/persistence/postgres/postgres-workspace-artifact-store';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const pool = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || '5432'), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: 'agentstore_test', max: 3 });
  const db = drizzle(pool, { schema });
  const store = new PostgresWorkspaceArtifactStore(db as never);
  const record = await store.create({
    workspaceId: 'a1a1a1a1a1a1a1a1a1a1a1a1', type: 'decision_flow', name: 'DebugFlow2', status: 'queued', schemaVersion: 1,
    primarySource: { documentId: 'd1d1d1d1d1d1d1d1d1d1d1d1', documentName: 's.pdf', selection: { mode: 'all' } },
    generationOptions: { flowType: 'eligibility', targetAudiences: ['infer_from_document'], detailLevel: 'standard', ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true } },
    generation: { agentId: 'c3c3c3c3c3c3c3c3c3c3c3c3', requestedBy: 'b2b2b2b2b2b2b2b2b2b2b2b2', attempts: 1, nextAttemptAt: new Date(Date.now() - 1000) },
    createdBy: 'b2b2b2b2b2b2b2b2b2b2b2b2', updatedBy: 'b2b2b2b2b2b2b2b2b2b2b2b2',
  });
  console.log('created', record.id);
  const raw1 = await pool.query(`SELECT id FROM workspace.workspace_artifacts WHERE generation_attempts < 2 AND ((status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) OR (status='generating' AND lease_expires_at <= now())) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
  console.log('candidate subquery rows:', JSON.stringify(raw1.rows));
  const claim = await store.claim(2, 5);
  console.log('claim:', claim?.artifact.id ?? 'NULL');
  await pool.query('DELETE FROM workspace.workspace_artifacts WHERE id = $1', [record.id]);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
