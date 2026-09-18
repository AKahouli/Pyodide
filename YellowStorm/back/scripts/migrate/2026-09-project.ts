/**
 * Step A backfill: Mongo `projects` + `project-shares` → Postgres `project` schema.
 * Runs on the shared migrate harness. Ids and timestamps are preserved byte-exact.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-project.ts [--dry-run] [--resume-from=<id>] [--fix-orphans]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { count, inArray } from 'drizzle-orm';
import * as schema from '../../src/modules/postgres/schema';
import { runBackfill } from './harness';
import type { OrphanEdge } from './orphans';
import type { MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const num = (v: unknown): number => Number(v ?? 0);
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v ?? Date.now())));

async function main(): Promise<void> {
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

  const userIds = new Set(
    (await usersCol.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)),
  );
  const amongUsers = async (ids: string[]): Promise<Set<string>> =>
    new Set(ids.filter((id) => userIds.has(id)));
  const projectIdsInPg = async (ids: string[]): Promise<Set<string>> => {
    const rows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(inArray(schema.projects.id, ids));
    return new Set(rows.map((r) => r.id));
  };

  // ponytail: in-array lookups are unchunked — fine for the current 12/4-row
  // collections; chunk if project_shares ever grows past a few thousand rows.
  const userEdge = (label: string, mongoPath: string): OrphanEdge => ({
    label,
    path: mongoPath,
    exists: amongUsers,
  });

  console.log('=== projects ===');
  const projectsStats = await runBackfill({
    collection: projectsCol,
    build: (doc: MongoDoc) => ({
      id: String(doc._id),
      name: String(doc.name ?? ''),
      createdBy: String(doc.createdBy ?? ''),
      isPublic: Boolean(doc.isPublic),
      shareCount: num(doc.shareCount),
      createdAt: date(doc.createdAt),
      updatedAt: date(doc.updatedAt),
    }),
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.name) return 'missing name';
      if (!u.createdBy) return 'missing createdBy';
      return null;
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
  });

  console.log('=== project-shares ===');
  const sharesStats = await runBackfill({
    collection: sharesCol,
    build: (doc: MongoDoc) => ({
      id: String(doc._id),
      projectId: String(doc.projectId ?? ''),
      ownerId: String(doc.ownerId ?? ''),
      sharedWithUserId: String(doc.sharedWithUserId ?? ''),
      permission: doc.permission === 'readwrite' ? 'readwrite' : 'read',
      sharedBy: String(doc.sharedBy ?? ''),
      createdAt: date(doc.createdAt),
      updatedAt: date(doc.updatedAt),
    }),
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.projectId) return 'missing projectId';
      if (!u.sharedWithUserId) return 'missing sharedWithUserId';
      return null;
    },
    unitId: (u) => u.id,
    exists: async (id) =>
      (await db.select({ id: schema.projectShares.id }).from(schema.projectShares).where(inArray(schema.projectShares.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.projectShares).values(u);
    },
    refs: [
      {
        label: 'project-shares.projectId → project.projects (PG)',
        path: 'projectId',
        exists: projectIdsInPg,
        // --fix-orphans drops shares whose project has no PG row (they would violate the FK).
        fix: async (docIds) => {
          await sharesCol.deleteMany({ _id: { $in: docIds.map((id) => new mongoose.Types.ObjectId(id)) } });
        },
      },
      userEdge('project-shares.ownerId → users (Mongo)', 'ownerId'),
      userEdge('project-shares.sharedWithUserId → users (Mongo)', 'sharedWithUserId'),
      userEdge('project-shares.sharedBy → users (Mongo)', 'sharedBy'),
    ],
    pgCount: async () => {
      const [row] = await db.select({ n: count() }).from(schema.projectShares);
      return Number(row?.n ?? 0);
    },
    pgIds: async () => (await db.select({ id: schema.projectShares.id }).from(schema.projectShares)).map((r) => r.id),
  });

  await pool.end();
  await mongoose.disconnect();

  if (projectsStats.failures.length || sharesStats.failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
