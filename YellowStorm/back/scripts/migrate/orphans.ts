import type mongoose from 'mongoose';
import type { MongoDoc } from './harness';

export interface OrphanEdge {
  label: string;
  /** Mongo dot-path holding the referenced id(s), e.g. 'projectId' or 'primarySource.documentId'. */
  path: string;
  /** Which of the given ids exist at the reference target. */
  exists: (ids: string[]) => Promise<Set<string>>;
  /**
   * Fixer invoked only with --fix-orphans; receives the _ids of source docs
   * whose ref at `path` does not resolve (typically deleteMany).
   */
  fix?: (docIds: string[]) => Promise<void>;
}

export interface OrphanReportItem {
  label: string;
  /** Docs whose ref does not resolve. */
  orphanDocs: number;
  /** Sample of orphaned doc _ids. */
  sample: string[];
  fixed: number;
}

/**
 * Resolve a dot-path to the string id(s) stored there. Array values yield one
 * entry per element; scalars yield one.
 *
 * ponytail: handles object dot-paths and flat arrays of ids; arrays of
 * subdocuments with nested paths (e.g. 'files.0.docId') are out of scope until
 * a backfill needs them.
 */
export function getPath(doc: MongoDoc, dotPath: string): string[] {
  let current: unknown = doc;
  for (const part of dotPath.split('.')) {
    if (current == null || typeof current !== 'object') return [];
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return [];
  const values = Array.isArray(current) ? current : [current];
  return values.map((v) => String(v)).filter((v) => v && v !== 'undefined' && v !== '[object Object]');
}

/**
 * One pass over `collection`, resolving every edge's refs in chunks and
 * reporting docs whose refs do not resolve. With fix: true, each edge's fixer
 * runs on the orphaned doc ids.
 */
export async function reportOrphans(
  collection: mongoose.mongo.Collection,
  edges: OrphanEdge[],
  options: { fix?: boolean; batchSize?: number; sampleLimit?: number } = {},
): Promise<OrphanReportItem[]> {
  const batchSize = options.batchSize ?? 500;
  const sampleLimit = options.sampleLimit ?? 20;

  type Pair = { docId: string; refId: string };
  const pending = new Map<OrphanEdge, Pair[]>(
    edges.map((edge) => [edge, [] as Pair[]]),
  );

  for await (const doc of collection.find({}, { projection: { _id: 1, ...pathProjections(edges) } })) {
    const docId = String((doc as MongoDoc)._id);
    for (const edge of edges) {
      for (const refId of getPath(doc as MongoDoc, edge.path)) {
        pending.get(edge)!.push({ docId, refId });
      }
    }
  }

  const report: OrphanReportItem[] = [];
  for (const edge of edges) {
    const pairs = pending.get(edge)!;
    const existing = await edge.exists([...new Set(pairs.map((p) => p.refId))]);
    const orphanDocIds = [...new Set(pairs.filter((p) => !existing.has(p.refId)).map((p) => p.docId))];
    const item: OrphanReportItem = {
      label: edge.label,
      orphanDocs: orphanDocIds.length,
      sample: orphanDocIds.slice(0, sampleLimit),
      fixed: 0,
    };
    if (options.fix && orphanDocIds.length && edge.fix) {
      await edge.fix(orphanDocIds);
      item.fixed = orphanDocIds.length;
    }
    report.push(item);
  }
  return report;
}

/** Mongo projection limited to _id + each edge's top-level field. */
function pathProjections(edges: OrphanEdge[]): Record<string, 1> {
  const projection: Record<string, 1> = {};
  for (const edge of edges) {
    const root = edge.path.split('.')[0];
    projection[root] = 1;
  }
  return projection;
}
