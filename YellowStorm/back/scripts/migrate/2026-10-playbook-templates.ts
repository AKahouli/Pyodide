/**
 * P5 backfill (package A2) — the playbook-flow templates, output formats, HITL memories and mail
 * trigger ledger, Mongo → Postgres:
 *
 *   playbook_flow_node_templates      → playbook.node_templates
 *   playbook_flow_prompt_templates    → playbook.prompt_templates
 *   playbook_flow_output_formats      → playbook.output_formats
 *   flowhitlmemories                  → playbook.hitl_memories
 *   playbook_flow_mail_event_ledgers  → playbook.mail_event_ledgers
 *
 * The mapping lives in 2026-10-playbook-templates.units.ts. Ids are preserved (lower-cased ObjectId
 * hex). Run it after the flows backfill: output formats, memories and ledger entries belong to a flow.
 *
 *   - a template whose key already exists (the prompt seeder of the new build inserts the built-in
 *     prompts into an empty table under new ids) counts as migrated and is skipped; those keys are
 *     listed at the end of the pass, their Mongo content is NOT copied over the seeded row;
 *   - rows whose flow or owner is gone are reported as failures (the foreign keys would reject them),
 *     never silently dropped;
 *   - the source execution of an output format and the execution of a ledger entry are soft
 *     references, kept even when that run is gone (counted at the end of the pass).
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * A --dry-run writes nothing, so the flows of the Mongo `flows` collection stand in for the flows
 * pass that has not written them yet.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-templates.ts [--dry-run] [--verify] [--checksum] [--only=<pass>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { parseFlags, runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-playbook-templates.units';
import type { Row, TemplateRefs } from './2026-10-playbook-templates.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface Pass {
  key: string;
  collection: string;
  table: string;
  columns: string[];
  build: (doc: MongoDoc) => Row;
  validate: (row: Row, refs: TemplateRefs) => string | null;
  /** Unique by key as well as by id: a row with the same key counts as migrated. */
  byKey?: boolean;
  /** The soft execution reference counted after the pass. */
  softExecution?: string;
}

const PASSES: Pass[] = [
  { key: 'node_templates', collection: 'playbook_flow_node_templates', table: 'playbook.node_templates', columns: u.NODE_TEMPLATE_COLUMNS, build: u.buildNodeTemplate, validate: (row) => u.validateNodeTemplate(row), byKey: true },
  { key: 'prompt_templates', collection: 'playbook_flow_prompt_templates', table: 'playbook.prompt_templates', columns: u.PROMPT_TEMPLATE_COLUMNS, build: u.buildPromptTemplate, validate: (row) => u.validatePromptTemplate(row), byKey: true },
  { key: 'output_formats', collection: 'playbook_flow_output_formats', table: 'playbook.output_formats', columns: u.OUTPUT_FORMAT_COLUMNS, build: u.buildOutputFormat, validate: u.validateOutputFormat, softExecution: 'source_execution_id' },
  { key: 'hitl_memories', collection: 'flowhitlmemories', table: 'playbook.hitl_memories', columns: u.HITL_MEMORY_COLUMNS, build: u.buildHitlMemory, validate: u.validateHitlMemory },
  { key: 'mail_ledger', collection: 'playbook_flow_mail_event_ledgers', table: 'playbook.mail_event_ledgers', columns: u.MAIL_LEDGER_COLUMNS, build: u.buildMailLedger, validate: u.validateMailLedger, softExecution: 'execution_id' },
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
  const { dryRun } = parseFlags();

  const idSet = async (sql: string): Promise<Set<string>> => new Set((await pool.query(sql)).rows.map((r) => String(r.id)));
  const mongoFlows = dryRun
    ? new Set((await mdb.collection('flows').find({}, { projection: { _id: 1 } }).toArray()).map((doc) => String(doc._id).toLowerCase()))
    : new Set<string>();
  const loadRefs = async (): Promise<TemplateRefs> => {
    const [users, flows] = await Promise.all([idSet('SELECT id FROM identity.users'), idSet('SELECT id FROM playbook.flows')]);
    return { users, flows: new Set([...flows, ...mongoFlows]) };
  };

  for (const pass of PASSES) {
    if (only && only !== pass.key) continue;
    const refs = await loadRefs();
    console.log(`\n##### ${pass.key}: ${pass.collection} → ${pass.table}`);
    const units = new Map<string, Row>();
    const takenKeys: string[] = [];
    const where = (row: Row): { sql: string; values: unknown[] } => (pass.byKey
      ? { sql: 'id = $1 OR key = $2', values: [row.id, row.key] }
      : { sql: 'id = $1', values: [row.id] });

    await runBackfill({
      collection: mdb.collection(pass.collection),
      build: (doc) => {
        const row = pass.build(doc);
        units.set(String(row.id), row);
        return row;
      },
      validate: (row) => pass.validate(row, refs),
      insert: (row) => u.insertRow(pool, pass.table, pass.columns, row),
      unitId: (row) => String(row.id),
      exists: async (id) => {
        const row = units.get(id)!;
        const { sql, values } = where(row);
        const found = await pool.query(`SELECT id FROM ${pass.table} WHERE ${sql}`, values);
        if (pass.byKey && found.rows.some((r) => r.id !== id)) takenKeys.push(`${row.key} (mongo ${id}, postgres ${found.rows[0].id})`);
        return (found.rowCount ?? 0) > 0;
      },
      verify: async (rows) => {
        const issues = new Map<string, string>();
        for (const row of rows) {
          const { sql, values } = where(row);
          if ((await pool.query(`SELECT 1 FROM ${pass.table} WHERE ${sql}`, values)).rowCount === 0) issues.set(String(row.id), 'missing in PG');
        }
        return issues;
      },
      checksumRows: async (ids) =>
        new Map((await pool.query(`SELECT ${u.checksumSelect(pass.columns)} FROM ${pass.table} WHERE id = ANY($1::char(24)[])`, [ids])).rows.map((r) => [String(r.id), r as Row])),
      pgCount: async () => (await pool.query(`SELECT count(*)::int AS n FROM ${pass.table}`)).rows[0].n,
      pgIds: async () => (await pool.query(`SELECT id FROM ${pass.table}`)).rows.map((r) => String(r.id)),
    });

    if (takenKeys.length) {
      console.log(`=== ${pass.key}: ${takenKeys.length} key(s) already in Postgres under another id (seeded before the backfill; Mongo content not copied) ===`);
      for (const line of takenKeys) console.log(`  ${line}`);
    }
    if (pass.softExecution) {
      const executions = await idSet('SELECT id FROM playbook.executions');
      const gone = [...units.values()].filter((row) => row[pass.softExecution!] != null && !executions.has(String(row[pass.softExecution!])));
      console.log(`=== ${pass.key}: ${gone.length} soft reference(s) to an execution not in Postgres (kept) ===`);
    }
  }

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
