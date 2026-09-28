/**
 * One-off repair: copies a playbook's graph (nodes, control edges, data bindings) from the Mongo
 * `flows` document into playbook.flows, cast exactly like the app writes it, and bumps the
 * definition revision so open editors reload. Mongo is only read.
 *
 * Usage (from YellowStorm/back): npx ts-node scripts/restore-flow-from-mongo.ts <flowId> [--dry-run]
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Pool } from 'pg';
import { castControlEdges, castDataBindings, castFlowNodes } from '../src/modules/playbook-flow/persistence/flow-cast';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  const id = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!/^[0-9a-f]{24}$/.test(id ?? '')) throw new Error('usage: restore-flow-from-mongo.ts <flowId> [--dry-run]');

  await mongoose.connect(process.env.MONGODB_URI!);
  const doc = await mongoose.connection.db!.collection('flows').findOne({ _id: new mongoose.Types.ObjectId(id) });
  await mongoose.disconnect();
  if (!doc) throw new Error(`flow ${id} not found in Mongo`);
  const cast = {
    nodes: castFlowNodes<unknown>(doc.nodes), controlEdges: castControlEdges<unknown>(doc.controlEdges), dataBindings: castDataBindings<unknown>(doc.dataBindings),
  };
  console.log(`Mongo: nodes=${cast.nodes.length} edges=${cast.controlEdges.length} bindings=${cast.dataBindings.length}`);

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });
  try {
    const db = (await pool.query('select current_database() db')).rows[0].db;
    const before = await pool.query(
      'select definition_revision rev, jsonb_array_length(nodes) n, jsonb_array_length(control_edges) e, jsonb_array_length(data_bindings) b from playbook.flows where id = $1',
      [id],
    );
    console.log(`${db} before: ${JSON.stringify(before.rows[0] ?? null)}`);
    if (!before.rows.length) throw new Error(`flow ${id} not found in Postgres`);
    if (dryRun) return console.log('dry run: nothing written');
    const after = await pool.query(
      `UPDATE playbook.flows
          SET nodes = $2::jsonb, control_edges = $3::jsonb, data_bindings = $4::jsonb,
              definition_revision = definition_revision + 1, updated_at = now()
        WHERE id = $1
    RETURNING definition_revision rev, jsonb_array_length(nodes) n, jsonb_array_length(control_edges) e, jsonb_array_length(data_bindings) b`,
      [id, JSON.stringify(cast.nodes), JSON.stringify(cast.controlEdges), JSON.stringify(cast.dataBindings)],
    );
    console.log(`${db} after:  ${JSON.stringify(after.rows[0])}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
