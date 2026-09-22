/**
 * Step D backfill: Mongo workspace domain → Postgres `workspace` schema.
 * Order (plan D.4): workspace_settings → workspaces → workspace_documents → workspace-shares.
 * Ids, storage prefixes, timestamps and stored counters (documentCount, usedStorage,
 * shareCount) are copied as-is — never recomputed. Folder documents are inserted with a
 * NULL parent first, then re-linked in a second pass so insertion order never violates
 * the self-referencing FK.
 *
 * Run scripts/dedupe-document-original-names.ts first: the partial unique index
 * (workspace_id, original_name) WHERE is_folder = false rejects duplicates Mongo tolerates.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-workspace.ts [--dry-run] [--resume-from=<id>]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { count, eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/modules/postgres/schema';
import { runBackfill, BackfillError, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const num = (v: unknown, fallback = 0): number => (v == null ? fallback : Number(v));
const bool = (v: unknown): boolean => Boolean(v);
const date = (v: unknown): Date | undefined => (v == null ? undefined : v instanceof Date ? v : new Date(String(v)));

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;
  const usersCol = mdb.collection('users');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 4,
  });
  const db = drizzle(pool, { schema });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle branded table types don't union
  const pgCount = async (table: any): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(table);
    return Number(row?.n ?? 0);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgIds = async (table: any): Promise<string[]> =>
    (await db.select({ id: table.id }).from(table)).map((r) => r.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existsIn = async (table: any, id: string): Promise<boolean> =>
    (await db.select({ id: table.id }).from(table).where(inArray(table.id, [id]))).length > 0;

  const userIds = new Set((await usersCol.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const amongUsers = async (ids: string[]): Promise<Set<string>> => new Set(ids.filter((id) => userIds.has(id)));

  // ---- 1. workspace_settings ----
  console.log('=== workspace_settings ===');
  const settingsStats = await runBackfill({
    collection: mdb.collection('workspace_settings'),
    build: (doc: MongoDoc) => ({
      id: String(doc._id),
      name: String(doc.name ?? ''),
      description: str(doc.description),
      tag: str(doc.tag),
      llmModel: str(doc.llmModel),
      isTemplate: bool(doc.isTemplate),
      isPredefined: bool(doc.isPredefined),
      createdBy: String(doc.createdBy ?? ''),
      instruction: str(doc.instruction),
      chunks: num(doc.chunks, 5),
      hybridSearch: bool(doc.hybridSearch),
      ragType: String(doc.ragType ?? 'standard'),
      maxToken: num(doc.maxToken, 4096),
      topK: num(doc.topK, 10),
      createdAt: date(doc.createdAt)!,
      updatedAt: date(doc.updatedAt)!,
    }),
    validate: (u) => (!u.id ? 'missing _id' : !u.name ? 'missing name' : !u.createdBy ? 'missing createdBy' : null),
    unitId: (u) => u.id,
    exists: async (id) => (await db.select({ id: schema.workspaceSettings.id }).from(schema.workspaceSettings).where(inArray(schema.workspaceSettings.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.workspaceSettings).values(u);
    },
    refs: [{ label: 'workspace_settings.createdBy → users (Mongo)', path: 'createdBy', exists: amongUsers }],
    pgCount: () => pgCount(schema.workspaceSettings),
    pgIds: () => pgIds(schema.workspaceSettings),
  });

  // ---- 2. workspaces ----
  console.log('=== workspaces ===');
  const counterDrift: string[] = [];
  const workspaceStats = await runBackfill({
    collection: mdb.collection('workspaces'),
    build: (doc: MongoDoc) => {
      // Detect negative counters on the RAW Mongo values (before clamping) so
      // the drift report is a real audit trail of clamped ids.
      const raw = {
        documentCount: num(doc.documentCount),
        usedStorage: num(doc.usedStorage),
        allocatedStorage: num(doc.allocatedStorage),
        shareCount: num(doc.shareCount),
      };
      if (raw.documentCount < 0 || raw.usedStorage < 0 || raw.shareCount < 0 || raw.allocatedStorage < 0) {
        counterDrift.push(String(doc._id ?? '(no id)'));
      }
      return {
      id: String(doc._id),
      name: String(doc.name ?? ''),
      alias: String(doc.alias ?? ''),
      storagePrefix: String(doc.storagePrefix ?? ''),
      description: str(doc.description),
      createdBy: String(doc.createdBy ?? ''),
      settingsId: doc.settings == null ? undefined : String(doc.settings),
      // Clamped counters: Mongo drift can drive stored counters negative, which
      // the DDL CHECKs reject. Clamped ids are reported in the drift report;
      // values are otherwise copied as-is, never recomputed.
      documentCount: Math.max(0, raw.documentCount),
      usedStorage: Math.max(0, raw.usedStorage),
      allocatedStorage: Math.max(0, raw.allocatedStorage),
      isSystem: bool(doc.isSystem),
      isPersonal: bool(doc.isPersonal),
      shareCount: Math.max(0, raw.shareCount),
      isPublic: bool(doc.isPublic),
      conversationId: str(doc.conversationId),
      createdAt: date(doc.createdAt)!,
      updatedAt: date(doc.updatedAt)!,
      };
    },
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.name) return 'missing name';
      if (!u.alias) return 'missing alias';
      if (!u.storagePrefix) return 'missing storagePrefix (Ceph keys depend on it)';
      if (!u.createdBy) return 'missing createdBy';
      return null;
    },
    unitId: (u) => u.id,
    exists: async (id) => existsIn(schema.workspaces, id),
    insert: async (u) => {
      // Orphaned settings refs would violate settings_id's FK; a deleted setting
      // must not block the workspace's migration (ON DELETE SET NULL semantics).
      if (u.settingsId && !(await existsIn(schema.workspaceSettings, u.settingsId))) {
        u.settingsId = undefined;
      }
      await db.insert(schema.workspaces).values(u);
    },
    refs: [
      { label: 'workspaces.createdBy → users (Mongo)', path: 'createdBy', exists: amongUsers },
      {
        label: 'workspaces.settingsId → workspace_settings (PG)',
        path: 'settings',
        // ponytail: unchunked in-array; fine for 2.6k workspaces, chunk if it grows past ~10k
        exists: async (ids) => new Set((await db.select({ id: schema.workspaceSettings.id }).from(schema.workspaceSettings).where(inArray(schema.workspaceSettings.id, ids))).map((r) => r.id)),
      },
    ],
    pgCount: () => pgCount(schema.workspaces),
    pgIds: () => pgIds(schema.workspaces),
  });
  if (counterDrift.length) {
    console.log('=== counter drift: negative counters clamped to 0 ===');
    console.log(JSON.stringify({ workspaces: counterDrift.length, sample: counterDrift.slice(0, 10) }, null, 2));
  }

  // ---- 3. workspace_documents (two-pass folder insert) ----
  console.log('=== workspace_documents (pass 1: NULL parent) ===');
  const documentsCol = mdb.collection('workspace_documents');
  const buildDocument = (doc: MongoDoc) => {
    const originalName = String(doc.originalName ?? '');
    if (!originalName) throw new BackfillError('missing originalName', String(doc._id ?? '(no id)'));
    return {
      id: String(doc._id),
      filename: str(doc.filename),
      originalName,
      mimeType: String(doc.mimeType ?? 'application/octet-stream'),
      size: num(doc.size),
      path: str(doc.path),
      url: str(doc.url),
      contentHash: str(doc.contentHash),
      workspaceId: String(doc.workspaceId ?? ''),
      createdBy: String(doc.createdBy ?? ''),
      status: String(doc.status ?? 'pending'),
      uploadedAt: date(doc.uploadedAt),
      errorMessage: str(doc.errorMessage),
      metadata: (doc.metadata ?? undefined) as Record<string, string> | undefined,
      indexingStatus: String(doc.indexingStatus ?? 'none'),
      indexingError: str(doc.indexingError),
      indexingTaskName: str(doc.indexingTaskName),
      indexingTaskId: str(doc.indexingTaskId),
      indexingAttemptId: str(doc.indexingAttemptId),
      indexingAttemptStartedAt: date(doc.indexingAttemptStartedAt),
      indexingAttemptCompletedAt: date(doc.indexingAttemptCompletedAt),
      lastIndexedAt: date(doc.lastIndexedAt),
      indexingStartedAt: date(doc.indexingStartedAt),
      detectedLanguage: str(doc.detected_language),
      chunkSize: doc.chunk_size == null ? undefined : num(doc.chunk_size),
      isFolder: bool(doc.isFolder),
      folderName: str(doc.folderName),
      type: String(doc.type ?? 'doc'),
      sourceUrl: str(doc.sourceUrl),
      createdAt: date(doc.createdAt)!,
      updatedAt: date(doc.updatedAt)!,
    };
  };
  const documentsStats = await runBackfill({
    collection: documentsCol,
    build: buildDocument,
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.workspaceId) return 'missing workspaceId';
      if (!u.createdBy) return 'missing createdBy';
      return null;
    },
    unitId: (u) => u.id,
    exists: async (id) => existsIn(schema.workspaceDocuments, id),
    // Pass 1 inserts every document with a NULL parent so folder order never
    // violates the self-referencing FK; pass 2 re-links below.
    insert: async (u) => {
      await db.insert(schema.workspaceDocuments).values({ ...u, parentId: undefined });
    },
    pgCount: () => pgCount(schema.workspaceDocuments),
    pgIds: () => pgIds(schema.workspaceDocuments),
  });

  // Pass 2: re-link parents from Mongo; report docs whose parent is missing (3 known orphans).
  console.log('=== workspace_documents (pass 2: parent re-link) ===');
  let relinked = 0;
  const orphanParents: string[] = [];
  for await (const doc of documentsCol.find({ parentId: { $ne: null } }, { projection: { _id: 1, parentId: 1 } })) {
    const id = String(doc._id);
    const parentId = String(doc.parentId);
    const parentExists = await existsIn(schema.workspaceDocuments, parentId);
    if (!parentExists) {
      orphanParents.push(`${id} (parent ${parentId})`);
      continue;
    }
    await db.update(schema.workspaceDocuments).set({ parentId }).where(eq(schema.workspaceDocuments.id, id));
    relinked += 1;
  }
  console.log(JSON.stringify({ relinked, orphanParents: orphanParents.length, sample: orphanParents.slice(0, 10) }, null, 2));

  // ---- 4. workspace-shares ----
  console.log('=== workspace-shares ===');
  const sharesStats = await runBackfill({
    collection: mdb.collection('workspace-shares'),
    build: (doc: MongoDoc) => ({
      id: String(doc._id),
      workspaceId: String(doc.workspaceId ?? ''),
      ownerId: String(doc.ownerId ?? ''),
      sharedWithUserId: String(doc.sharedWithUserId ?? ''),
      permission: doc.permission === 'readwrite' ? 'readwrite' : 'read',
      sharedBy: String(doc.sharedBy ?? ''),
      createdAt: date(doc.createdAt)!,
      updatedAt: date(doc.updatedAt)!,
    }),
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.workspaceId) return 'missing workspaceId';
      if (!u.sharedWithUserId) return 'missing sharedWithUserId';
      return null;
    },
    unitId: (u) => u.id,
    exists: async (id) => (await db.select({ id: schema.workspaceShares.id }).from(schema.workspaceShares).where(inArray(schema.workspaceShares.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.workspaceShares).values(u);
    },
    refs: [
      { label: 'workspace-shares.workspaceId → workspaces (PG)', path: 'workspaceId', exists: async (ids) => new Set((await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(inArray(schema.workspaces.id, ids))).map((r) => r.id)) },
      { label: 'workspace-shares.sharedWithUserId → users (Mongo)', path: 'sharedWithUserId', exists: amongUsers },
    ],
    pgCount: () => pgCount(schema.workspaceShares),
    pgIds: () => pgIds(schema.workspaceShares),
  });

  const failed =
    settingsStats.failures.length +
    workspaceStats.failures.length +
    documentsStats.failures.length +
    sharesStats.failures.length +
    orphanParents.length;

  await pool.end();
  await mongoose.disconnect();
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
