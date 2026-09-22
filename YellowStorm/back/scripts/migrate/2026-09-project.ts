/**
 * Step A backfill: Mongo `projects` + `project-shares` → Postgres `project` schema.
 * Runs on the shared migrate harness. Ids and timestamps are preserved byte-exact.
 *
 * Bad data is never patched: docs with missing/invalid timestamps, an unknown
 * permission, or a missing/invalid id reference are REJECTED (skipped and listed
 * in the rejects report). Shares whose project is not migrated are skipped and
 * reported too. Mongo is never mutated (--fix-orphans is a no-op here).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-project.ts
 *          [--dry-run] [--resume-from=<id>] [--strict] [--checksum] [--verify]
 *   --strict  Pre-scan both collections and abort (exit 1, nothing written)
 *             when any doc would be rejected.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { count, inArray } from 'drizzle-orm';
import * as schema from '../../src/modules/postgres/schema';
import { BackfillError, parseFlags, runBackfill } from './harness';
import type { OrphanEdge } from './orphans';
import type { MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const REJECT_PREFIX = 'REJECTED: ';

const num = (v: unknown): number => Number(v ?? 0);
/** Strict date: undefined when absent or unparseable (never "now"). */
const date = (v: unknown): Date | undefined => {
  if (v == null) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};
/** Lowercase 24-hex id, or undefined (never '' — that would pad into a blank char(24)). */
const oid = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const s = String(v);
  return OBJECT_ID.test(s) ? s.toLowerCase() : undefined;
};

interface Reject {
  collection: string;
  id: string;
  problems: string[];
}

export function projectProblems(doc: MongoDoc): string[] {
  const problems: string[] = [];
  if (!oid(doc._id)) problems.push('invalid _id');
  if (!String(doc.name ?? '').trim()) problems.push('missing name');
  if (!oid(doc.createdBy)) problems.push('missing/invalid createdBy');
  if (!date(doc.createdAt)) problems.push('missing/invalid createdAt');
  if (!date(doc.updatedAt)) problems.push('missing/invalid updatedAt');
  return problems;
}

export function shareProblems(doc: MongoDoc, migratedProjectIds: Set<string>): string[] {
  const problems: string[] = [];
  if (!oid(doc._id)) problems.push('invalid _id');
  const projectId = oid(doc.projectId);
  if (!projectId) problems.push('missing/invalid projectId');
  else if (!migratedProjectIds.has(projectId)) problems.push('orphan: projectId has no migrated project');
  for (const field of ['ownerId', 'sharedWithUserId', 'sharedBy'] as const) {
    if (!oid(doc[field])) problems.push(`missing/invalid ${field}`);
  }
  if (doc.permission !== 'read' && doc.permission !== 'readwrite') {
    problems.push(`unknown permission ${JSON.stringify(doc.permission)}`);
  }
  if (!date(doc.createdAt)) problems.push('missing/invalid createdAt');
  if (!date(doc.updatedAt)) problems.push('missing/invalid updatedAt');
  return problems;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;
  const projectsCol = mdb.collection('projects');
  const sharesCol = mdb.collection('project-shares');
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

  // Pre-scan (read-only): rejects + the set of projects that will be migrated,
  // so shares pointing at a rejected/missing project are skipped, not inserted.
  const rejects: Reject[] = [];
  const migratedProjectIds = new Set<string>();
  for await (const doc of projectsCol.find({})) {
    const problems = projectProblems(doc as MongoDoc);
    if (problems.length) rejects.push({ collection: 'projects', id: String(doc._id), problems });
    else migratedProjectIds.add(oid(doc._id)!);
  }
  for await (const doc of sharesCol.find({})) {
    const problems = shareProblems(doc as MongoDoc, migratedProjectIds);
    if (problems.length) rejects.push({ collection: 'project-shares', id: String(doc._id), problems });
  }
  const printRejects = (): void => {
    console.log(`=== rejects (${rejects.length}) — skipped, Mongo untouched ===`);
    for (const r of rejects) console.log(`  ${r.collection} ${r.id}: ${r.problems.join('; ')}`);
  };
  if (flags.strict && rejects.length) {
    printRejects();
    console.error('--strict: aborting before any write because some documents would be rejected.');
    await pool.end();
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }
  if (flags.fixOrphans) {
    console.log('--fix-orphans is ignored by this script: orphans are skipped and reported, Mongo is never mutated.');
  }

  const userIds = new Set(
    (await usersCol.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)),
  );
  const amongUsers = async (ids: string[]): Promise<Set<string>> =>
    new Set(ids.filter((id) => userIds.has(id)));
  const projectIdsInPg = async (ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(inArray(schema.projects.id, ids.map((id) => id.toLowerCase())));
    return new Set(rows.map((r) => r.id));
  };

  // ponytail: in-array lookups are unchunked — fine for the current 12/4-row
  // collections; chunk if project_shares ever grows past a few thousand rows.
  const userEdge = (label: string, mongoPath: string): OrphanEdge => ({
    label,
    path: mongoPath,
    exists: amongUsers,
  });
  const reject = (id: string, problems: string[]): never => {
    throw new BackfillError(`${REJECT_PREFIX}${problems.join('; ')}`, id);
  };

  console.log('=== projects ===');
  const projectsStats = await runBackfill({
    collection: projectsCol,
    build: (doc: MongoDoc) => {
      const problems = projectProblems(doc);
      if (problems.length) reject(String(doc._id), problems);
      return {
        id: oid(doc._id)!,
        name: String(doc.name),
        createdBy: oid(doc.createdBy)!,
        isPublic: Boolean(doc.isPublic),
        shareCount: num(doc.shareCount),
        createdAt: date(doc.createdAt)!,
        updatedAt: date(doc.updatedAt)!,
      };
    },
    unitId: (u) => u.id,
    exists: async (id) =>
      (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.projects).values(u);
    },
    refs: [userEdge('projects.createdBy → users (Mongo)', 'createdBy')],
    pgCount: async () => {
      const [row] = await db.select({ n: count() }).from(schema.projects);
      return Number(row?.n ?? 0);
    },
    pgIds: async () => (await db.select({ id: schema.projects.id }).from(schema.projects)).map((r) => r.id),
    checksumRows: async (ids) =>
      new Map(
        (await db.select().from(schema.projects).where(inArray(schema.projects.id, ids))).map((r) => [r.id, r]),
      ),
  });

  console.log('=== project-shares ===');
  const sharesStats = await runBackfill({
    collection: sharesCol,
    build: (doc: MongoDoc) => {
      const problems = shareProblems(doc, migratedProjectIds);
      if (problems.length) reject(String(doc._id), problems);
      return {
        id: oid(doc._id)!,
        projectId: oid(doc.projectId)!,
        ownerId: oid(doc.ownerId)!,
        sharedWithUserId: oid(doc.sharedWithUserId)!,
        permission: doc.permission as 'read' | 'readwrite',
        sharedBy: oid(doc.sharedBy)!,
        createdAt: date(doc.createdAt)!,
        updatedAt: date(doc.updatedAt)!,
      };
    },
    unitId: (u) => u.id,
    exists: async (id) =>
      (await db.select({ id: schema.projectShares.id }).from(schema.projectShares).where(inArray(schema.projectShares.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.projectShares).values(u);
    },
    // Report-only: orphaned shares are skipped by build(), never deleted from Mongo.
    refs: [
      { label: 'project-shares.projectId → project.projects (PG)', path: 'projectId', exists: projectIdsInPg },
      userEdge('project-shares.ownerId → users (Mongo)', 'ownerId'),
      userEdge('project-shares.sharedWithUserId → users (Mongo)', 'sharedWithUserId'),
      userEdge('project-shares.sharedBy → users (Mongo)', 'sharedBy'),
    ],
    pgCount: async () => {
      const [row] = await db.select({ n: count() }).from(schema.projectShares);
      return Number(row?.n ?? 0);
    },
    pgIds: async () => (await db.select({ id: schema.projectShares.id }).from(schema.projectShares)).map((r) => r.id),
    checksumRows: async (ids) =>
      new Map(
        (await db.select().from(schema.projectShares).where(inArray(schema.projectShares.id, ids))).map((r) => [r.id, r]),
      ),
  });

  printRejects();

  await pool.end();
  await mongoose.disconnect();

  // Rejects are an expected, reported outcome; anything else is a real failure.
  const realFailures = [...projectsStats.failures, ...sharesStats.failures].filter(
    (f) => !f.reason.startsWith(REJECT_PREFIX),
  );
  if (realFailures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
