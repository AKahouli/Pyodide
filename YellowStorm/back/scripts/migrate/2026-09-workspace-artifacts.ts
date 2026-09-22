/**
 * Step B backfill: Mongo `workspace_artifacts` → Postgres `workspace.workspace_artifacts`.
 * Promotes primarySource.documentId into primary_source_document_id (fails loudly when
 * absent — the column is NOT NULL and indexed). Ids and timestamps preserved.
 * generation.usage → generation_usage (jsonb).
 *
 * Clones whose clonedFromArtifactId points at an artifact that no longer
 * exists in Mongo would violate the self-FK on every run: their
 * cloned_from_artifact_id is written as NULL and the count is reported.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-09-workspace-artifacts.ts
 *          [--dry-run] [--resume-from=<id>] [--verify] [--checksum]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { count, inArray } from 'drizzle-orm';
import * as schema from '../../src/modules/postgres/schema';
import { runBackfill, BackfillError, type MongoDoc } from './harness';
import type { OrphanEdge } from './orphans';
import type { WorkspaceArtifactUsage } from '../../src/modules/workspace-artifact/persistence/workspace-artifact-store';
import type { DecisionFlowGenerationOptions } from '../../src/modules/workspace-artifact/interfaces/workspace-artifact.interface';
import type { DecisionFlowPayload } from '../../src/modules/workspace-artifact/interfaces/decision-flow.interface';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const date = (v: unknown): Date | undefined => (v == null ? undefined : v instanceof Date ? v : new Date(String(v)));

/** Mongo generation.usage → jsonb; absent/malformed → undefined (NULL). */
function usage(v: unknown): WorkspaceArtifactUsage | undefined {
  if (v == null || typeof v !== 'object') return undefined;
  const u = v as Record<string, unknown>;
  return {
    inputTokens: Number(u.inputTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? 0),
    ...(u.model == null ? {} : { model: String(u.model) }),
  };
}

interface ArtifactRow {
  id: string;
  workspaceId: string;
  type: string;
  name: string;
  description?: string;
  status: string;
  schemaVersion: number;
  revision: number;
  primarySource: { documentId: string; documentName: string; contentHash?: string; selection: { mode: 'all' } | { mode: 'pages'; pages: number[] } };
  primarySourceDocumentId: string;
  generationOptions: DecisionFlowGenerationOptions;
  payload?: DecisionFlowPayload;
  generationAgentId: string;
  generationRequestedBy: string;
  generationAttempts: number;
  generationStartedAt?: Date;
  generationCompletedAt?: Date;
  generationError?: string;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  nextAttemptAt?: Date;
  generationUsage?: WorkspaceArtifactUsage;
  clonedFromArtifactId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  const mdb = mongoose.connection.db!;
  const artifactsCol = mdb.collection('workspace_artifacts');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 4,
  });
  const db = drizzle(pool, { schema });

  // Every artifact id in Mongo: a clone whose source is absent here can never
  // satisfy fk_artifacts_cloned_from, so its link is dropped (and reported).
  const mongoArtifactIds = new Set(
    (await artifactsCol.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)),
  );
  const nulledClones = new Set<string>();
  const amongArtifacts = async (ids: string[]): Promise<Set<string>> =>
    new Set(ids.filter((id) => mongoArtifactIds.has(id)));
  const workspaceIdsInPg = async (ids: string[]): Promise<Set<string>> => {
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(inArray(schema.workspaces.id, ids.slice(i, i + 1000)));
      for (const r of rows) found.add(r.id);
    }
    return found;
  };
  const refs: OrphanEdge[] = [
    { label: 'workspace_artifacts.workspaceId → workspace.workspaces (PG)', path: 'workspaceId', exists: workspaceIdsInPg },
    {
      label: 'workspace_artifacts.clonedFromArtifactId → workspace_artifacts (Mongo; link nulled on backfill)',
      path: 'clonedFromArtifactId',
      exists: amongArtifacts,
    },
  ];

  const stats = await runBackfill<ArtifactRow>({
    collection: artifactsCol,
    build: (doc: MongoDoc) => {
      const primarySource = doc.primarySource as Record<string, unknown> | undefined;
      const documentId = primarySource?.documentId == null ? '' : String(primarySource.documentId);
      if (!documentId) {
        throw new BackfillError('primarySource.documentId is missing — cannot derive primary_source_document_id', String(doc._id ?? '(no id)'));
      }
      const generation = (doc.generation ?? {}) as Record<string, unknown>;
      const status = String(doc.status ?? 'queued');
      const leaseExpiresAt = date(generation.leaseExpiresAt);
      // A 'generating' row without a lease could never be reclaimed by the new
      // store (claim() requires lease_expires_at <= now()) — fail loudly instead
      // of wedging it forever as an undeletable, un-retryable artifact.
      if (status === 'generating' && !leaseExpiresAt) {
        throw new BackfillError('status is generating but generation.leaseExpiresAt is missing', String(doc._id ?? '(no id)'));
      }
      const clonedFrom = (d: MongoDoc): string | undefined => {
        if (d.clonedFromArtifactId == null) return undefined;
        const source = String(d.clonedFromArtifactId);
        if (mongoArtifactIds.has(source)) return source;
        nulledClones.add(String(d._id));
        return undefined;
      };
      const row: ArtifactRow = {
        id: String(doc._id),
        workspaceId: String(doc.workspaceId ?? ''),
        type: String(doc.type ?? ''),
        name: String(doc.name ?? ''),
        description: doc.description == null ? undefined : String(doc.description),
        status,
        schemaVersion: Number(doc.schemaVersion ?? 1),
        revision: Number(doc.revision ?? 0),
        primarySource: {
          documentId,
          documentName: String(primarySource?.documentName ?? ''),
          contentHash: primarySource?.contentHash == null ? undefined : String(primarySource.contentHash),
          selection: (primarySource?.selection ?? { mode: 'all' }) as ArtifactRow['primarySource']['selection'],
        },
        primarySourceDocumentId: documentId,
        generationOptions: doc.generationOptions as DecisionFlowGenerationOptions,
        payload: (doc.payload ?? undefined) as DecisionFlowPayload | undefined,
        generationAgentId: String(generation.agentId ?? ''),
        generationRequestedBy: String(generation.requestedBy ?? ''),
        generationAttempts: Number(generation.attempts ?? 0),
        generationStartedAt: date(generation.startedAt),
        generationCompletedAt: date(generation.completedAt),
        generationError: generation.error == null ? undefined : String(generation.error),
        leaseToken: generation.leaseToken == null ? undefined : String(generation.leaseToken),
        leaseExpiresAt,
        nextAttemptAt: date(generation.nextAttemptAt),
        generationUsage: usage(generation.usage),
        clonedFromArtifactId: clonedFrom(doc),
        createdBy: String(doc.createdBy ?? ''),
        updatedBy: String(doc.updatedBy ?? ''),
        createdAt: date(doc.createdAt)!,
        updatedAt: date(doc.updatedAt)!,
      };
      return row;
    },
    validate: (u) => {
      if (!u.id) return 'missing _id';
      if (!u.workspaceId) return 'missing workspaceId';
      if (!u.name) return 'missing name';
      if (!u.generationAgentId) return 'missing generation.agentId';
      if (!u.generationRequestedBy) return 'missing generation.requestedBy';
      if (!u.createdBy) return 'missing createdBy';
      return null;
    },
    unitId: (u) => u.id,
    exists: async (id) =>
      (await db.select({ id: schema.workspaceArtifacts.id }).from(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, [id]))).length > 0,
    insert: async (u) => {
      await db.insert(schema.workspaceArtifacts).values(u);
    },
    pgCount: async () => {
      const [row] = await db.select({ n: count() }).from(schema.workspaceArtifacts);
      return Number(row?.n ?? 0);
    },
    pgIds: async () => (await db.select({ id: schema.workspaceArtifacts.id }).from(schema.workspaceArtifacts)).map((r) => r.id),
    refs,
    checksumRows: async (ids) =>
      new Map(
        (await db.select().from(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, ids))).map((r) => [
          r.id,
          r as unknown as Record<string, unknown>,
        ]),
      ),
  });

  console.log(`=== clones with a deleted source: cloned_from_artifact_id written as NULL (${nulledClones.size}) ===`);
  for (const id of [...nulledClones].slice(0, 50)) console.log(`  ${id}`);

  await pool.end();
  await mongoose.disconnect();
  if (stats.failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
