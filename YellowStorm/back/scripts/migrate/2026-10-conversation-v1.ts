/**
 * Conversation v1 history backfill — Mongo conversations / messages / reports → Postgres conversation.*.
 *
 * Conversation v1 moved to Postgres on 2026-08-30 on a fresh database, without its history (plan
 * 2026-08-29-conversation-postgres-migration.md, "Scope Update"); this copies that history in.
 * The mapping lives in 2026-10-conversation-v1.units.ts. Ids and createdAt/updatedAt are preserved;
 * stored counters (messageCount, lastMessageAt, isShared, isFirstMessage) are copied, never recomputed.
 *
 * Passes, in dependency order. Each loads what Postgres already holds plus what the earlier passes
 * accepted, so a --dry-run of a later pass still sees its parents:
 *   conversations  conversations → conversation.conversations with its ordered child rows
 *                  (conversation_workspaces, _selected_skills, _tagged_agents, _group_tagged_agents,
 *                  _group_members, _group_invites), one transaction per batch
 *   messages       messages → conversation.messages, the three self references left NULL
 *   links          messages (links only) → parent/question/answer_message_id, filled where still NULL
 *   mentions       conversations (groupMeta.members only) → conversation_member_mentions (they point at messages)
 *   reports        reports → conversation.reports
 * Not migrated: conversationsARCHIVE (an archive), shared_conversations and
 * conversation_playbook_handoffs (their counts are printed; both were empty on 2026-09-26).
 *
 * Data policy:
 *   - a conversation whose owner (createdBy) is not in identity.users is skipped and reported; its
 *     messages are skipped as "conversation skipped: …" and its mentions with it. created_by has no
 *     foreign key: this is a policy (such a conversation is unreachable), not a constraint;
 *   - an optional reference behind a validated foreign key whose target is gone is cleared the way
 *     the key's ON DELETE action would: system_workspace_id and project_id become NULL, a
 *     conversation_workspaces entry or a mention is dropped, a message self reference becomes NULL.
 *     Every clearing is counted per bucket;
 *   - a reference without a foreign key (pinned agent, tagged agents, skills, group members, sender,
 *     attached files, agent/member ids, every report reference) is copied as is — the live code
 *     resolves them leniently, as it did on Mongo — and counted when it points at nothing;
 *   - text over a column limit (title 200, content 50000, model id 100, …) is reported and the
 *     document skipped, never truncated; U+0000 is removed from text and jsonb and counted;
 *   - the embedded conversations.messages id array is not a source (messages.conversation_id is):
 *     its drift, and the drift of the stored messageCount, is reported only;
 *   - source fields with no Postgres column are listed (keys only) under "unmapped".
 * Idempotent: ON CONFLICT (id) DO NOTHING, child rows only next to a conversation this run inserted,
 * links only where NULL, mentions only for a conversation that has none. A re-run inserts nothing.
 * Never prints content: ids, counts and fixed labels only.
 *
 * Usage (from YellowStorm/back; POSTGRES_DB from .env unless set in the environment):
 *   npx ts-node scripts/migrate/2026-10-conversation-v1.ts [--dry-run] [--verify] [--checksum]
 *     [--only=conversations|messages|links|mentions|reports] [--batch-size=N]
 * --resume-from applies to every pass: combine it with --only.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { BackfillError, parseFlags, runBackfill, type BackfillStats, type MongoDoc } from './harness';
import * as u from './2026-10-conversation-v1.units';
import type { ConversationPlan, LinkPlan, MentionPlan, MessagePlan, Queryable, ReportPlan, Row } from './2026-10-conversation-v1.units';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Collection = mongoose.mongo.Collection;
export interface MongoSource {
  collection(name: string): Collection;
}

export const PASSES = ['conversations', 'messages', 'links', 'mentions', 'reports'] as const;
export type PassKey = (typeof PASSES)[number];
const NOT_MIGRATED = ['conversationsARCHIVE', 'shared_conversations', 'conversation_playbook_handoffs'];

export const LINKED_MESSAGES_FILTER = { $or: [{ parentMessageId: { $ne: null } }, { questionMessageId: { $ne: null } }, { answerMessageId: { $ne: null } }] };
export const MENTIONING_CONVERSATIONS_FILTER = { 'groupMeta.members.mentions.0': { $exists: true } };

/** Label counts keyed by document id, so a document rebuilt by --verify is not counted twice. */
class Tally {
  private readonly byLabel = new Map<string, Map<string, number>>();

  record(id: string, labels: string[]): void {
    const counts = new Map<string, number>();
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    for (const [label, n] of counts) {
      let perId = this.byLabel.get(label);
      if (!perId) this.byLabel.set(label, (perId = new Map()));
      perId.set(id, n);
    }
  }

  /** `{ label: { docs, refs } }`, largest first. */
  summary(): Record<string, { docs: number; refs: number }> {
    const rows = [...this.byLabel].map(([label, perId]) => [label, { docs: perId.size, refs: [...perId.values()].reduce((a, b) => a + b, 0) }] as const);
    return Object.fromEntries(rows.sort((a, b) => b[1].refs - a[1].refs));
  }

  /** `{ label: docs }`, largest first. */
  docs(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.summary()).map(([label, { docs }]) => [label, docs]));
  }
}

interface Tallies {
  skipped: Tally;
  cleared: Tally;
  danglingKept: Tally;
  anomalies: Tally;
  unmapped: Tally;
}
const newTallies = (): Tallies => ({ skipped: new Tally(), cleared: new Tally(), danglingKept: new Tally(), anomalies: new Tally(), unmapped: new Tally() });

/** A Postgres error without the offending value (only the code, the constraint and the message head). */
const pgReason = (error: unknown): string => {
  const e = error as { code?: string; constraint?: string; message?: string };
  const head = String(e?.message ?? error).split(': "')[0].slice(0, 200);
  return `insert failed: ${e?.code ? `[${e.code}] ` : ''}${head}${e?.constraint && !head.includes(e.constraint) ? ` (${e.constraint})` : ''}`;
};

async function inTransaction<T>(pool: Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client as unknown as Queryable);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Buffers plans and writes them a batch per transaction. A batch that fails is retried one plan at
 * a time, so one bad row fails alone and is reported with its id.
 */
class BatchWriter<P> {
  private buffer: P[] = [];
  private bytes = 0;
  written = 0;
  rows = 0;
  readonly failures: Array<{ id: string; reason: string }> = [];

  constructor(
    private readonly pool: Pool,
    private readonly write: (db: Queryable, plans: P[]) => Promise<number>,
    private readonly idOf: (plan: P) => string,
    private readonly maxRows: number,
    private readonly maxBytes: number,
    private readonly sizeOf: (plan: P) => number,
    private readonly onFailed: (id: string, reason: string) => void,
  ) {}

  async add(plan: P): Promise<void> {
    this.buffer.push(plan);
    this.bytes += this.sizeOf(plan);
    if (this.buffer.length >= this.maxRows || this.bytes >= this.maxBytes) await this.flush();
  }

  async flush(): Promise<void> {
    const plans = this.buffer;
    this.buffer = [];
    this.bytes = 0;
    if (!plans.length) return;
    try {
      this.rows += await inTransaction(this.pool, (db) => this.write(db, plans));
      this.written += plans.length;
    } catch {
      for (const plan of plans) {
        try {
          this.rows += await inTransaction(this.pool, (db) => this.write(db, [plan]));
          this.written += 1;
        } catch (error) {
          const reason = pgReason(error);
          this.failures.push({ id: this.idOf(plan), reason });
          this.onFailed(this.idOf(plan), reason);
        }
      }
    }
  }
}

interface PassSpec<P> {
  key: PassKey;
  source: string;
  target: string;
  collection: Collection;
  filter?: Record<string, unknown>;
  /** Mongo doc → plan; throws BackfillError (with a fixed label as message) to skip and report. */
  plan: (doc: MongoDoc) => P;
  idOf: (plan: P) => string;
  /** The checksum projection. */
  unit: (plan: P) => Row;
  exists: (id: string, plan: P) => boolean;
  write: (db: Queryable, plans: P[]) => Promise<number>;
  sizeOf?: (plan: P) => number;
  maxRows: number;
  readUnits: (db: Queryable, ids: string[]) => Promise<Map<string, Row>>;
  /** Of these ids, the ones whose data is in place in Postgres. */
  inPlace: (ids: string[]) => Promise<Set<string>>;
  pgCount: () => Promise<number>;
  pgIds: () => Promise<string[]>;
  onAccepted?: (id: string) => void;
  onFailed?: (id: string, reason: string) => void;
}

export interface PassReport {
  pass: PassKey;
  source: string;
  target: string;
  mongoDocs: number;
  accepted: number;
  alreadyInPostgres: number;
  written: number;
  rowsAffected: number;
  inPostgresAfter: number;
  skipped: Record<string, number>;
  insertFailures: Record<string, number>;
  cleared: Record<string, { docs: number; refs: number }>;
  danglingKept: Record<string, { docs: number; refs: number }>;
  anomalies: Record<string, { docs: number; refs: number }>;
  unmapped: Record<string, number>;
  verifyIssues: number | null;
  checksumMatch: boolean | null;
  elapsedMs: number;
  harness: Pick<BackfillStats, 'processed' | 'inserted' | 'skippedExisting' | 'skippedInvalid'> & { failed: number };
}

async function runPass<P>(pool: Pool, spec: PassSpec<P>, tallies: Tallies): Promise<PassReport> {
  const flags = parseFlags();
  const started = Date.now();
  console.log(`\n##### ${spec.key}: ${spec.source} → ${spec.target}`);
  let staged: P | null = null;
  const accepted: string[] = [];
  // --verify rebuilds every unit after the main loop: acceptance is recorded by the main loop only.
  let mainLoopDone = false;
  const stagedFor = (id: string): P => {
    if (!staged || spec.idOf(staged) !== id) throw new Error(`internal: no staged plan for ${id}`);
    return staged;
  };
  const writer = new BatchWriter<P>(pool, spec.write, spec.idOf, spec.maxRows, 8 * 1024 * 1024, spec.sizeOf ?? (() => 0), (id, reason) => {
    tallies.skipped.record(id, [reason]);
    spec.onFailed?.(id, reason);
  });

  const stats = await runBackfill<Row>({
    collection: spec.collection,
    filter: spec.filter,
    build: (doc) => {
      let plan: P;
      try {
        plan = spec.plan(doc);
      } catch (error) {
        const id = error instanceof BackfillError ? error.id : String(doc._id);
        tallies.skipped.record(id, [error instanceof Error ? error.message : String(error)]);
        throw error instanceof BackfillError ? error : new BackfillError(String(error), id);
      }
      staged = plan;
      if (!mainLoopDone) {
        accepted.push(spec.idOf(plan));
        spec.onAccepted?.(spec.idOf(plan));
      }
      return spec.unit(plan);
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => spec.exists(id, stagedFor(id)),
    insert: async (unit) => writer.add(stagedFor(String(unit.id))),
    flush: async () => {
      await writer.flush();
      mainLoopDone = true;
    },
    verify: async (units) => {
      const ids = units.map((unit) => String(unit.id));
      const present = await spec.inPlace(ids);
      const failed = new Map(writer.failures.map((f) => [f.id, f.reason]));
      return new Map(ids.filter((id) => !present.has(id)).map((id) => [id, failed.get(id) ?? 'not in Postgres']));
    },
    checksumRows: (ids) => spec.readUnits(pool, ids),
    pgCount: spec.pgCount,
    pgIds: spec.pgIds,
  });

  const acceptedIds = accepted;
  let inPostgresAfter = 0;
  for (let i = 0; i < acceptedIds.length; i += 1000) inPostgresAfter += (await spec.inPlace(acceptedIds.slice(i, i + 1000))).size;
  const failureReasons = new Tally();
  for (const f of writer.failures) failureReasons.record(f.id, [f.reason]);

  const report: PassReport = {
    pass: spec.key,
    source: spec.source,
    target: spec.target,
    mongoDocs: await spec.collection.countDocuments(spec.filter ?? {}),
    accepted: acceptedIds.length,
    alreadyInPostgres: stats.skippedExisting,
    written: writer.written,
    rowsAffected: writer.rows,
    inPostgresAfter,
    skipped: tallies.skipped.docs(),
    insertFailures: failureReasons.docs(),
    cleared: tallies.cleared.summary(),
    danglingKept: tallies.danglingKept.summary(),
    anomalies: tallies.anomalies.summary(),
    unmapped: tallies.unmapped.docs(),
    verifyIssues: flags.verify ? stats.verifyIssues.length : null,
    checksumMatch: flags.checksum ? !stats.failures.some((f) => f.id === '(checksum)') : null,
    elapsedMs: Date.now() - started,
    harness: { processed: stats.processed, inserted: stats.inserted, skippedExisting: stats.skippedExisting, skippedInvalid: stats.skippedInvalid, failed: stats.failures.length },
  };
  console.log(`=== pass summary: ${spec.key} ===`);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** The harness reads only `collectionName`, `countDocuments` and `find(...).sort(...)`: narrow what `find` returns. */
function projected(collection: Collection, projection: Record<string, 1>): Collection {
  return {
    collectionName: collection.collectionName,
    countDocuments: (filter?: Record<string, unknown>) => collection.countDocuments(filter ?? {}),
    find: (filter: Record<string, unknown>, options?: Record<string, unknown>) => collection.find(filter, { ...options, projection }),
  } as unknown as Collection;
}

export interface ConversationV1Result {
  database: string;
  dryRun: boolean;
  passes: PassReport[];
  mongoMessagesPerConversation: { conversationsWithMessages: number; messages: number };
  notMigrated: Record<string, number>;
  elapsedMs: number;
}

export async function runConversationV1Backfill(options: { mongo: MongoSource; pool: Pool; only?: PassKey }): Promise<ConversationV1Result> {
  const { mongo, pool, only } = options;
  const flags = parseFlags();
  const started = Date.now();
  const database = String((await pool.query('SELECT current_database() AS db')).rows[0].db);
  console.log(`=== conversation v1 backfill: target database ${database}${flags.dryRun ? ' (dry run)' : ''} ===`);
  const wants = (key: PassKey): boolean => !only || only === key;

  const idSet = async (sql: string, values: unknown[] = []): Promise<Set<string>> => new Set((await pool.query(sql, values)).rows.map((r) => String(r.id).trim()));
  const inTable = (table: string, column = 'id') => async (ids: string[]): Promise<Set<string>> =>
    idSet(`SELECT ${column} AS id FROM ${table} WHERE ${column} = ANY($1::char(24)[])`, [ids]);
  const count = (sql: string) => async (): Promise<number> => Number((await pool.query(sql)).rows[0].n);
  const ids = (sql: string) => async (): Promise<string[]> => (await pool.query(sql)).rows.map((r) => String(r.id).trim());

  const users = await idSet('SELECT id FROM identity.users');
  const workspaces = await idSet('SELECT id FROM workspace.workspaces');
  const projects = await idSet('SELECT id FROM project.projects');
  const agents = await idSet('SELECT id FROM public.agents');
  const skills = await idSet('SELECT id FROM catalog.skills');
  const documents = await idSet('SELECT id FROM workspace.workspace_documents');

  /** Ids accepted by earlier passes (a dry run writes nothing, its later passes still need them). */
  const acceptedConversations = new Set<string>();
  const acceptedMessages = new Set<string>();
  const skippedConversations = new Map<string, string>();
  const skippedMessages = new Map<string, string>();
  const union = (pg: Set<string>, accepted: Set<string>): Set<string> => new Set([...pg, ...accepted]);

  // The drift of the embedded conversations.messages array and of messageCount is reported against this.
  const messagesPerConversation = new Map<string, number>();
  const messageOwner = new Map<string, string>();
  for await (const doc of mongo.collection('messages').find({}, { projection: { conversationId: 1 } })) {
    const conversationId = String(doc.conversationId);
    messagesPerConversation.set(conversationId, (messagesPerConversation.get(conversationId) ?? 0) + 1);
    messageOwner.set(String(doc._id), conversationId);
  }
  const embeddedDrift = (doc: MongoDoc, id: string): string[] => {
    const actual = messagesPerConversation.get(id) ?? 0;
    const embedded = Array.isArray(doc.messages) ? doc.messages.map(String) : [];
    const out: string[] = [];
    if (embedded.length !== actual) out.push('drift: embedded messages[] length differs from the Mongo messages of the conversation');
    if (doc.messageCount !== actual) out.push('drift: stored messageCount differs from the Mongo messages of the conversation (copied as stored)');
    for (const messageId of embedded) {
      const owner = messageOwner.get(messageId);
      if (owner === undefined) out.push('drift: embedded messages[] id not in Mongo messages');
      else if (owner !== id) out.push('drift: embedded messages[] id belongs to another conversation');
    }
    return out;
  };

  const passes: PassReport[] = [];

  if (wants('conversations')) {
    const t = newTallies();
    const existing = await idSet('SELECT id FROM conversation.conversations');
    const refs = { users, workspaces, projects };
    passes.push(await runPass<ConversationPlan>(pool, {
      key: 'conversations',
      source: 'conversations',
      target: 'conversation.conversations (+ ordered child tables)',
      collection: mongo.collection('conversations'),
      plan: (doc) => {
        t.unmapped.record(String(doc._id), u.unmappedConversationPaths(doc));
        const plan = u.withLiveReferences(u.mapConversation(doc), refs);
        const id = String(plan.row.id);
        const reason = u.validateConversation(plan, refs);
        if (reason) {
          skippedConversations.set(id, reason);
          throw new BackfillError(reason, id);
        }
        t.anomalies.record(id, [...plan.anomalies, ...embeddedDrift(doc, id)]);
        t.cleared.record(id, plan.cleared);
        t.danglingKept.record(id, u.danglingKeptInConversation(plan, { users, agents, skills }));
        return plan;
      },
      idOf: (plan) => String(plan.row.id),
      unit: u.conversationUnit,
      exists: (id) => existing.has(id),
      write: u.writeConversations,
      maxRows: flags.batchSize,
      readUnits: u.readConversationUnits,
      inPlace: inTable('conversation.conversations'),
      pgCount: count('SELECT count(*)::int AS n FROM conversation.conversations'),
      pgIds: ids('SELECT id FROM conversation.conversations'),
      onAccepted: (id) => acceptedConversations.add(id),
      onFailed: (id, reason) => {
        acceptedConversations.delete(id);
        skippedConversations.set(id, reason);
      },
    }, t));
  }

  if (wants('messages')) {
    const t = newTallies();
    const existing = await idSet('SELECT id FROM conversation.messages');
    const conversations = union(await idSet('SELECT id FROM conversation.conversations'), acceptedConversations);
    passes.push(await runPass<MessagePlan>(pool, {
      key: 'messages',
      source: 'messages',
      target: 'conversation.messages (self references left NULL)',
      collection: mongo.collection('messages'),
      plan: (doc) => {
        t.unmapped.record(String(doc._id), u.unmappedMessagePaths(doc));
        const plan = u.mapMessage(doc);
        const id = String(plan.row.id);
        const reason = u.validateMessage(plan, { conversations }, skippedConversations);
        if (reason) {
          skippedMessages.set(id, reason);
          throw new BackfillError(reason, id);
        }
        t.anomalies.record(id, plan.anomalies);
        t.danglingKept.record(id, u.danglingKeptInMessage(plan, { users, agents, documents }));
        return plan;
      },
      idOf: (plan) => String(plan.row.id),
      unit: (plan) => u.messageUnit(plan.row),
      exists: (id) => existing.has(id),
      write: u.writeMessages,
      sizeOf: (plan) => plan.bytes,
      maxRows: flags.batchSize,
      readUnits: u.readMessageUnits,
      inPlace: inTable('conversation.messages'),
      pgCount: count('SELECT count(*)::int AS n FROM conversation.messages'),
      pgIds: ids('SELECT id FROM conversation.messages'),
      onAccepted: (id) => acceptedMessages.add(id),
      onFailed: (id, reason) => {
        acceptedMessages.delete(id);
        skippedMessages.set(id, reason);
      },
    }, t));
  }

  if (wants('links')) {
    const t = newTallies();
    const current = new Map((await pool.query(`SELECT ${u.LINK_COLUMNS.join(', ')} FROM conversation.messages`)).rows.map((r) => [String(r.id).trim(), r as Row]));
    const messages = union(new Set(current.keys()), acceptedMessages);
    const expected = new Map<string, Row>();
    passes.push(await runPass<LinkPlan>(pool, {
      key: 'links',
      source: 'messages (links)',
      target: 'conversation.messages parent/question/answer_message_id',
      collection: projected(mongo.collection('messages'), { parentMessageId: 1, questionMessageId: 1, answerMessageId: 1 }),
      filter: LINKED_MESSAGES_FILTER,
      plan: (doc) => {
        const plan = u.withLiveLinkTargets(u.mapMessageLinks(doc), messages);
        const id = String(plan.row.id);
        if (!messages.has(id)) {
          const why = skippedMessages.get(id);
          throw new BackfillError(why ? `message skipped: ${why}` : 'message is not in Postgres', id);
        }
        t.cleared.record(id, plan.cleared);
        expected.set(id, plan.row);
        return plan;
      },
      idOf: (plan) => String(plan.row.id),
      unit: (plan) => u.linkUnit(plan.row),
      exists: (id, plan) => u.linksInPlace(plan, current.get(id)),
      write: u.writeLinks,
      maxRows: flags.batchSize * 5,
      readUnits: u.readLinkUnits,
      inPlace: async (batch) => {
        const rows = await u.readLinkUnits(pool, batch);
        return new Set(batch.filter((id) => u.linksInPlace({ row: expected.get(id) ?? { id }, cleared: [] }, rows.get(id))));
      },
      pgCount: count('SELECT count(*)::int AS n FROM conversation.messages WHERE parent_message_id IS NOT NULL OR question_message_id IS NOT NULL OR answer_message_id IS NOT NULL'),
      pgIds: ids('SELECT id FROM conversation.messages WHERE parent_message_id IS NOT NULL OR question_message_id IS NOT NULL OR answer_message_id IS NOT NULL'),
    }, t));
  }

  if (wants('mentions')) {
    const t = newTallies();
    const conversations = union(await idSet('SELECT id FROM conversation.conversations'), acceptedConversations);
    const messages = union(await idSet('SELECT id FROM conversation.messages'), acceptedMessages);
    const mentioned = await idSet('SELECT DISTINCT conversation_id AS id FROM conversation.conversation_member_mentions');
    const expected = new Map<string, number>();
    passes.push(await runPass<MentionPlan>(pool, {
      key: 'mentions',
      source: 'conversations (groupMeta.members[].mentions)',
      target: 'conversation.conversation_member_mentions',
      collection: projected(mongo.collection('conversations'), { 'groupMeta.members.userId': 1, 'groupMeta.members.mentions': 1 }),
      filter: MENTIONING_CONVERSATIONS_FILTER,
      plan: (doc) => {
        const mapped = u.mapMentions(doc);
        const id = mapped.conversationId;
        if (!conversations.has(id)) {
          const why = skippedConversations.get(id);
          throw new BackfillError(why ? `conversation skipped: ${why}` : 'conversation is not in Postgres', id);
        }
        const plan = u.withLiveMentionMessages(mapped, messages);
        t.cleared.record(id, plan.cleared);
        t.anomalies.record(id, plan.anomalies);
        if (!plan.rows.length) throw new BackfillError('every mention points at a message that is not in Postgres', id);
        expected.set(id, plan.rows.length);
        return plan;
      },
      idOf: (plan) => plan.conversationId,
      unit: u.mentionUnit,
      exists: (id) => mentioned.has(id),
      write: u.writeMentions,
      maxRows: flags.batchSize,
      readUnits: u.readMentionUnits,
      inPlace: async (batch) => {
        const rows = await pool.query('SELECT conversation_id AS id, count(*)::int AS n FROM conversation.conversation_member_mentions WHERE conversation_id = ANY($1::char(24)[]) GROUP BY conversation_id', [batch]);
        return new Set(rows.rows.filter((r) => Number(r.n) >= (expected.get(String(r.id).trim()) ?? 1)).map((r) => String(r.id).trim()));
      },
      pgCount: count('SELECT count(DISTINCT conversation_id)::int AS n FROM conversation.conversation_member_mentions'),
      pgIds: ids('SELECT DISTINCT conversation_id AS id FROM conversation.conversation_member_mentions'),
    }, t));
  }

  if (wants('reports')) {
    const t = newTallies();
    const existing = await idSet('SELECT id FROM conversation.reports');
    const loose = {
      users,
      conversations: union(await idSet('SELECT id FROM conversation.conversations'), acceptedConversations),
      messages: union(await idSet('SELECT id FROM conversation.messages'), acceptedMessages),
    };
    passes.push(await runPass<ReportPlan>(pool, {
      key: 'reports',
      source: 'reports',
      target: 'conversation.reports',
      collection: mongo.collection('reports'),
      plan: (doc) => {
        t.unmapped.record(String(doc._id), u.unmappedReportPaths(doc));
        const plan = u.mapReport(doc);
        const id = String(plan.row.id);
        const reason = u.validateReport(plan);
        if (reason) throw new BackfillError(reason, id);
        t.anomalies.record(id, plan.anomalies);
        t.danglingKept.record(id, u.danglingKeptInReport(plan, loose));
        return plan;
      },
      idOf: (plan) => String(plan.row.id),
      unit: (plan) => u.reportUnit(plan.row),
      exists: (id) => existing.has(id),
      write: u.writeReports,
      maxRows: flags.batchSize,
      readUnits: u.readReportUnits,
      inPlace: inTable('conversation.reports'),
      pgCount: count('SELECT count(*)::int AS n FROM conversation.reports'),
      pgIds: ids('SELECT id FROM conversation.reports'),
    }, t));
  }

  const notMigrated: Record<string, number> = {};
  for (const name of NOT_MIGRATED) notMigrated[name] = await mongo.collection(name).countDocuments({});

  const result: ConversationV1Result = {
    database,
    dryRun: flags.dryRun,
    passes,
    mongoMessagesPerConversation: { conversationsWithMessages: messagesPerConversation.size, messages: messageOwner.size },
    notMigrated,
    elapsedMs: Date.now() - started,
  };
  console.log('\n=== conversation v1 backfill: summary ===');
  console.log(JSON.stringify({
    database,
    dryRun: flags.dryRun,
    elapsedMs: result.elapsedMs,
    passes: passes.map((p) => ({
      pass: p.pass, mongoDocs: p.mongoDocs, accepted: p.accepted, alreadyInPostgres: p.alreadyInPostgres, written: p.written, inPostgresAfter: p.inPostgresAfter,
      skipped: Object.values(p.skipped).reduce((a, b) => a + b, 0), insertFailures: Object.values(p.insertFailures).reduce((a, b) => a + b, 0),
      verifyIssues: p.verifyIssues, checksumMatch: p.checksumMatch, elapsedMs: p.elapsedMs,
    })),
    notMigrated,
  }, null, 2));
  return result;
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  if (only !== undefined && !(PASSES as readonly string[]).includes(only)) throw new Error(`--only must be one of ${PASSES.join('|')}`);
  await mongoose.connect(process.env.MONGODB_URI);
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });
  try {
    await runConversationV1Backfill({ mongo: mongoose.connection.db!, pool, only: only as PassKey | undefined });
  } finally {
    await mongoose.disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
