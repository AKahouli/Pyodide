/**
 * P5 backfill, package C: the Playbook assistant and design workspace collections -> playbook.*.
 *
 * The mapping, and what is copied or reported, is documented in 2026-10-playbook-assistant.units.ts.
 * Ids are preserved (lower-cased ObjectId hex). The design passes need their flows (and users) in
 * Postgres first: run after the flow definitions backfill. Each pass loads the ids already in Postgres,
 * plus the design message ids accepted so far (a revert points at an earlier message of the same pass).
 * The TTL passes copy only rows whose expiresAt is still ahead; run them close to the cutover.
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/migrate/2026-10-playbook-assistant.ts [--dry-run] [--verify] [--checksum] [--only=<pass>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';
import * as u from './2026-10-playbook-assistant.units';
import type { PlaybookAssistantRefs, Row } from './2026-10-playbook-assistant.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface Pass {
  key: string;
  collection: string;
  table: string;
  columns: string[];
  build: (doc: MongoDoc) => Row;
  validate: (row: Row, refs: PlaybookAssistantRefs) => string | null;
  /** Soft references nulled when their target is gone. */
  fixup?: (row: Row, refs: PlaybookAssistantRefs) => Row;
  /** Accepted rows are design messages later rows may point at. */
  providesDesignMessages?: boolean;
}

const PASSES: Pass[] = [
  { key: 'requests', collection: 'playbookassistantrequests', table: 'playbook.assistant_requests', columns: u.REQUEST_COLUMNS, build: u.buildRequest, validate: (row) => u.validateRequest(row) },
  { key: 'operations', collection: 'playbookassistantoperations', table: 'playbook.assistant_operations', columns: u.OPERATION_COLUMNS, build: u.buildOperation, validate: (row) => u.validateOperation(row) },
  { key: 'messages', collection: 'playbookassistantmessages', table: 'playbook.assistant_messages', columns: u.MESSAGE_COLUMNS, build: u.buildMessage, validate: (row) => u.validateMessage(row) },
  { key: 'revisions', collection: 'playbookassistantrevisions', table: 'playbook.assistant_revisions', columns: u.REVISION_COLUMNS, build: u.buildRevision, validate: (row) => u.validateRevision(row) },
  { key: 'attachments', collection: 'playbookassistantattachments', table: 'playbook.assistant_attachments', columns: u.ATTACHMENT_COLUMNS, build: u.buildAttachment, validate: (row) => u.validateAttachment(row) },
  {
    key: 'design_messages', collection: 'playbook_flow_design_messages', table: 'playbook.design_messages', columns: u.DESIGN_MESSAGE_COLUMNS,
    build: u.buildDesignMessage, validate: u.validateDesignMessage, fixup: u.withLiveRevertedMessage, providesDesignMessages: true,
  },
  {
    key: 'design_operations', collection: 'flowdesignoperations', table: 'playbook.design_operations', columns: u.DESIGN_OPERATION_COLUMNS,
    build: u.buildDesignOperation, validate: u.validateDesignOperation, fixup: u.withLiveAppliedMessage,
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
  const acceptedDesignMessages = new Set<string>();

  for (const pass of PASSES) {
    if (only && only !== pass.key) continue;
    const [users, flows, designMessages] = await Promise.all([
      idSet('SELECT id FROM identity.users'),
      idSet('SELECT id FROM playbook.flows'),
      idSet('SELECT id FROM playbook.design_messages'),
    ]);
    // Live view: a revert accepted in this very pass is visible to the rows after it.
    const refs: PlaybookAssistantRefs = {
      users,
      flows,
      designMessages: { has: (id: string) => designMessages.has(id) || acceptedDesignMessages.has(id) },
    };
    const filter = u.TTL_COLLECTIONS.includes(pass.collection) ? { expiresAt: { $gt: new Date() } } : undefined;
    console.log(`\n##### ${pass.key}: ${pass.collection} -> ${pass.table}${filter ? ' (expiresAt in the future only)' : ''}`);
    if (filter) {
      const expired = (await mdb.collection(pass.collection).countDocuments()) - (await mdb.collection(pass.collection).countDocuments(filter));
      console.log(`=== expired, not copied: ${expired}`);
    }
    await runBackfill({
      collection: mdb.collection(pass.collection),
      filter,
      build: pass.build,
      validate: (row) => {
        const reason = pass.validate(row, refs);
        if (!reason && pass.providesDesignMessages) acceptedDesignMessages.add(String(row.id));
        return reason;
      },
      insert: async (row) => u.insertRow(pool, pass.table, pass.columns, pass.fixup ? pass.fixup(row, refs) : row),
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
  }

  console.log('\n=== not migrated (legacy collections nothing reads any more) ===');
  for (const name of u.NOT_MIGRATED) console.log(`  ${name}: ${await mdb.collection(name).estimatedDocumentCount()} docs`);

  await mongoose.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
