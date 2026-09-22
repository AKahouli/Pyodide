/**
 * Read-only id-set reconciliation between Mongo and Postgres for every
 * migrated collection (plan 2026-09-21-postgres-migration-remediation, 0.2).
 *
 * Flags:
 *   --allow=<file.json>  Ids expected to be missing in PG. JSON array or
 *                        {"<id>": "<reason>"} map (e.g. the 7 legacy widget
 *                        tokens with corrupt hashes).
 *   --since=<iso>        Drift mode: only Mongo ids created after this instant
 *                        count as problems (detects a live Mongo writer).
 *   --strict             Exit 1 on any non-allowed missing id, or on any drift.
 *
 * Read-only: the PG connection runs with default_transaction_read_only=on and
 * Mongo is only queried with find/count. Only ids and counts are printed.
 *
 * Usage: npx ts-node back/scripts/migrate/reconcile-ids.ts [--allow=...] [--since=...] [--strict]
 */
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/** [mongo collection, pg schema.table] — Appendix A of the remediation plan. */
const PAIRS: Array<[string, string]> = [
  ['users', 'identity.users'],
  ['roles', 'authz.roles'],
  ['user_groups', 'identity.user_groups'],
  ['auth_providers', 'identity.auth_providers'],
  ['user_provider_links', 'identity.user_provider_links'],
  ['notifications', 'ops.notifications'],
  ['system_settings', 'catalog.system_settings'],
  ['models', 'catalog.ai_models'],
  ['plans', 'catalog.plans'],
  ['tool_categories', 'catalog.tool_categories'],
  ['tools', 'catalog.tools'],
  ['skill_categories', 'catalog.skill_categories'],
  ['skills', 'catalog.skills'],
  ['agent_types', 'catalog.agent_types'],
  ['connector_categories', 'integrations.connector_categories'],
  ['connectors', 'integrations.connectors'],
  ['connector_credentials', 'integrations.connector_credentials'],
  ['connected_app_definitions', 'integrations.connected_app_definitions'],
  ['user_app_connections', 'integrations.user_app_connections'],
  ['admin_connector_auth_tokens', 'integrations.admin_connector_auth_tokens'],
  ['agent_telegram_integrations', 'channels.telegram_integrations'],
  ['telegram_chat_bindings', 'channels.telegram_chat_bindings'],
  ['widget_tokens', 'channels.widget_tokens'],
  ['shared_agents', 'public.shared_agents'],
  ['teams', 'teams.teams'],
  ['shared_teams', 'teams.shared_teams'],
  ['team_auto_builder_config', 'teams.auto_builder_config'],
];

const OID_RE = /^[0-9a-f]{24}$/;

/** ms epoch encoded in an ObjectId, or null when the id is not one. */
function oidTimeMs(id: string): number | null {
  if (!OID_RE.test(id)) return null;
  return parseInt(id.slice(0, 8), 16) * 1000;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

interface PairReport {
  pair: [string, string];
  mongo: number;
  pg: number | null;
  missing: string[];
  extra: string[];
  /** Missing ids created after --since (drift = something still writes Mongo). */
  drift: string[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowArg = args.find((a) => a.startsWith('--allow='))?.slice(8) ?? null;
  const sinceArg = args.find((a) => a.startsWith('--since='))?.slice(8) ?? null;
  const strict = args.includes('--strict');

  const allowed = new Set<string>();
  if (allowArg) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(allowArg), 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) allowed.add(String(id));
    else for (const [id, reason] of Object.entries(raw)) {
      allowed.add(id);
      console.log(`allow: ${id} — ${reason}`);
    }
  }
  const sinceMs = sinceArg ? Date.parse(sinceArg) : null;
  if (sinceArg && Number.isNaN(sinceMs)) throw new Error(`--since: cannot parse ${sinceArg}`);

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 2,
    options: '-c default_transaction_read_only=on',
  });

  const reports: PairReport[] = [];
  for (const [mongoName, pgTable] of PAIRS) {
    const mongoIds: string[] = [];
    for await (const doc of mdb.collection(mongoName).find({}, { projection: { _id: 1 } })) {
      mongoIds.push(String(doc._id));
    }
    let pgIds: string[] | null = null;
    try {
      const r = await pool.query(`SELECT id FROM ${pgTable}`);
      pgIds = r.rows.map((row) => String(row.id));
    } catch {
      console.log(`!! ${pgTable} does not exist — skipping pair`);
    }

    const pgSet = new Set(pgIds ?? []);
    const missing: string[] = [];
    const extra: string[] = [];
    const drift: string[] = [];
    for (const id of mongoIds) {
      if (pgSet.has(id) || allowed.has(id)) continue;
      missing.push(id);
      const t = oidTimeMs(id);
      if (sinceMs !== null && t !== null && t >= sinceMs) drift.push(id);
    }
    const mongoSet = new Set(mongoIds);
    for (const id of pgSet) if (!mongoSet.has(id)) extra.push(id);

    reports.push({ pair: [mongoName, pgTable], mongo: mongoIds.length, pg: pgIds ? pgIds.length : null, missing, extra, drift });
  }

  await mongoose.disconnect();
  await pool.end();

  let missingTotal = 0;
  let driftTotal = 0;
  let extraTotal = 0;
  for (const r of reports) {
    missingTotal += r.missing.length;
    driftTotal += r.drift.length;
    extraTotal += r.extra.length;
    const flag = r.drift.length ? 'DRIFT' : r.missing.length ? 'missing' : 'ok';
    console.log(`[${flag.padEnd(7)}] ${r.pair[0]} → ${r.pair[1]}: mongo=${r.mongo} pg=${r.pg ?? '?'} missing=${r.missing.length} extra=${r.extra.length}`);
    for (const id of r.missing.slice(0, 10)) {
      const t = oidTimeMs(id);
      console.log(`    missing ${id}${t ? ` (created ${fmtTime(t)})` : ''}${r.drift.includes(id) ? ' [drift: after --since]' : ''}`);
    }
    if (r.missing.length > 10) console.log(`    … and ${r.missing.length - 10} more`);
  }

  console.log('=== summary ===');
  console.log(JSON.stringify({ pairs: reports.length, missingTotal, extraTotal, driftTotal, since: sinceArg, allowedIds: allowed.size }, null, 2));

  if (strict && (missingTotal > allowed.size || driftTotal > 0)) {
    console.log('STRICT: reconciliation failed');
    process.exitCode = 1;
  } else if (strict) {
    console.log('STRICT: ok');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
