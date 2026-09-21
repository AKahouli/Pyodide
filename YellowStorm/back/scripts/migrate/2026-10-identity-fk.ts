/**
 * Step 1A.17 — cross-schema FK pass for the identity phase.
 *
 * identity↔authz FKs are created by 0021 (both schemas land together). The
 * only deferred reference is users.plan_id → catalog.plans, whose target
 * arrives with 1B.3; until then this script only reports orphans.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-identity-fk.ts
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

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
  });

  const planIds = new Set(
    (await mdb.collection('plans').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)),
  );
  const users = await pool.query<{ id: string; plan_id: string | null }>('SELECT id, plan_id FROM identity.users WHERE plan_id IS NOT NULL');
  const orphans = users.rows.filter((u) => !planIds.has(u.plan_id!));

  console.log('=== identity deferred FK report ===');
  console.log(JSON.stringify({
    edge: 'identity.users.plan_id → catalog.plans (FK added in 1B.3)',
    totalWithPlan: users.rows.length,
    orphanDocs: orphans.length,
    sample: orphans.slice(0, 20).map((u) => ({ user: u.id, plan: u.plan_id })),
  }, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
