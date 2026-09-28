/**
 * P5 backfill (package A1) — Mongo `flows` and `shared_playbooks` → Postgres playbook.flows,
 * playbook.flow_workspaces and playbook.shared_playbooks.
 *
 * The mapping lives in 2026-10-playbook-flows.units.ts. Ids are preserved (lower-cased ObjectId hex).
 * Passes run in dependency order (flows with their workspaces, then shares); each pass loads the ids
 * already in Postgres plus those the earlier passes accepted, so a --dry-run of the shares sees the flows.
 *
 *   - a flow whose owner is gone, or whose name or description the model cannot hold, is reported as a
 *     failure, never silently dropped;
 *   - a workspace id that no longer exists in workspace.workspaces is dropped from the junction (the
 *     foreign key cannot hold it), the flow is kept; the count is printed;
 *   - a share whose flow or users are gone is reported as a failure.
 * Idempotent: ON CONFLICT (id) DO NOTHING (a flow already in Postgres keeps its workspaces).
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-flows.ts [--dry-run] [--verify] [--checksum] [--only=<flows|shares>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-playbook-flows.units';
import type { PlaybookFlowRefs, Row } from './2026-10-playbook-flows.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface Pass {
  key: string;
  collection: string;
  table: string;
  columns: string[];
  build: (doc: MongoDoc) => Row;
  validate: (row: Row, refs: PlaybookFlowRefs) => string | null;
  insert: (pool: Pool, row: Row, refs: PlaybookFlowRefs) => Promise<void>;
  /** The reference set this pass feeds. */
  provides?: keyof PlaybookFlowRefs;
}

const PASSES: Pass[] = [
  {
    key: 'flows', collection: 'flows', table: 'playbook.flows', columns: u.FLOW_COLUMNS, build: u.buildFlow, validate: u.validateFlow,
    insert: (pool, row, refs) => u.insertFlow(pool, row, refs), provides: 'flows',
  },
  {
    key: 'shares', collection: 'shared_playbooks', table: 'playbook.shared_playbooks', columns: u.SHARE_COLUMNS, build: u.buildShare, validate: u.validateShare,
    insert: (pool, row) => u.insertRow(pool, 'playbook.shared_playbooks', u.SHARE_COLUMNS, row),
  },
];

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

  const idSet = async (sql: string): Promise<Set<string>> => new Set((await pool.query(sql)).rows.map((r) => String(r.id)));
  /** Flows accepted by the flows pass: a dry-run writes nothing, but the shares still need their flows. */
  const acceptedFlows = new Set<string>();
  const loadRefs = async (): Promise<PlaybookFlowRefs> => {
    const [users, workspaces, flows] = await Promise.all([
      idSet('SELECT id FROM identity.users'),
      idSet('SELECT id FROM workspace.workspaces'),
      idSet('SELECT id FROM playbook.flows'),
    ]);
    return { users, workspaces, flows: new Set([...flows, ...acceptedFlows]) };
  };

  for (const pass of PASSES) {
    if (only && only !== pass.key) continue;
    const refs = await loadRefs();
    console.log(`\n##### ${pass.key}: ${pass.collection} → ${pass.table}`);
    let droppedWorkspaces = 0;
    await runBackfill({
      collection: mdb.collection(pass.collection),
      build: pass.build,
      validate: (row) => {
        const reason = pass.validate(row, refs);
        if (!reason && pass.provides === 'flows') {
          acceptedFlows.add(String(row.id));
          droppedWorkspaces += u.flowWorkspaces(row).length - u.liveWorkspaces(row, refs).length;
        }
        return reason;
      },
      insert: (row) => pass.insert(pool, row, refs),
      unitId: (row) => String(row.id),
      exists: async (id) => (await pool.query(`SELECT 1 FROM ${pass.table} WHERE id = $1`, [id])).rowCount! > 0,
      verify: async (rows) => {
        const issues = new Map<string, string>();
        for (const row of rows) {
          if ((await pool.query(`SELECT 1 FROM ${pass.table} WHERE id = $1`, [row.id])).rowCount === 0) issues.set(String(row.id), 'missing in PG');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.checksumSelect(pass.columns)} FROM ${pass.table} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${pass.table}`)).rows[0].n,
      pgIds: async () => (await pool.query(`SELECT id FROM ${pass.table}`)).rows.map((r) => String(r.id)),
    });

    if (pass.key === 'flows') {
      const mongoRefs = (await mdb.collection('flows').aggregate([{ $group: { _id: null, n: { $sum: { $size: { $ifNull: ['$workspaces', []] } } } } }]).toArray())[0]?.n ?? 0;
      const pgRefs = (await pool.query('SELECT count(*)::int AS n FROM playbook.flow_workspaces')).rows[0].n;
      console.log(`=== workspaces === mongo ${mongoRefs} references, postgres ${pgRefs} rows, ${droppedWorkspaces} dropped (workspace gone or malformed id)`);
    }
  }

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
