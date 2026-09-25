/**
 * Mongo → Postgres mapping of the four classifier collections (roadmap P6).
 * Kept apart from the runner so a spec can drive the same mapping, validation and insert with
 * fabricated documents (tree ordering, dangling parents) that the small dev data never exercises.
 *
 * Unit rows use the Postgres column names as keys; `columns` is both the insert list and the
 * checksum read-back list, so the two cannot drift apart.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

/** Ids present in Postgres, loaded once: the foreign keys reject a row whose parent is gone. */
export interface ClassifierRefs {
  workspaces: ReadonlySet<string>;
  documents: ReadonlySet<string>;
  users: ReadonlySet<string>;
  /** playbook.flows: a run points at its playbook with a foreign key (0041). */
  playbooks: ReadonlySet<string>;
}

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dNow = (v: unknown): Date => d(v) ?? new Date();
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
const hexIdOrNull = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = String(v).toLowerCase();
  return HEX.test(raw) ? raw : null;
};

const stamps = (doc: MongoDoc) => ({ created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) });
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));

export const FOLDER_COLUMNS = ['id', 'workspace_id', 'parent_id', 'name', 'description', 'created_by', 'created_at', 'updated_at'];
export const ASSIGNMENT_COLUMNS = ['id', 'workspace_id', 'document_id', 'folder_id', 'assignment_source', 'classification_run_id', 'assigned_by', 'created_at', 'updated_at'];
export const RULE_COLUMNS = ['id', 'user_id', 'scope', 'workspace_id', 'text', 'enabled', 'created_at', 'updated_at'];
export const RUN_COLUMNS = ['id', 'workspace_id', 'status', 'playbook_id', 'playbook_execution_id', 'hint', 'overwrite_existing', 'total_files', 'classified_files', 'error', 'started_at', 'finished_at', 'triggered_by', 'created_at', 'updated_at'];

export const buildFolder = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    workspace_id: hexId(doc.workspaceId, 'workspaceId', id),
    parent_id: hexIdOrNull(doc.parentId),
    name: sReq(doc.name),
    description: sReq(doc.description),
    created_by: hexId(doc.createdBy, 'createdBy', id),
    ...stamps(doc),
  };
};

export const buildAssignment = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    workspace_id: hexId(doc.workspaceId, 'workspaceId', id),
    document_id: hexId(doc.documentId, 'documentId', id),
    folder_id: hexIdOrNull(doc.folderId),
    assignment_source: sReq(doc.assignmentSource ?? 'manual'),
    classification_run_id: hexIdOrNull(doc.classificationRunId),
    assigned_by: hexId(doc.assignedBy, 'assignedBy', id),
    ...stamps(doc),
  };
};

export const buildRule = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    user_id: hexId(doc.userId, 'userId', id),
    scope: sReq(doc.scope),
    workspace_id: hexIdOrNull(doc.workspaceId),
    text: sReq(doc.text),
    enabled: doc.enabled !== false,
    ...stamps(doc),
  };
};

export const buildRun = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    workspace_id: hexId(doc.workspaceId, 'workspaceId', id),
    status: sReq(doc.status ?? 'queued'),
    playbook_id: hexId(doc.playbookId, 'playbookId', id),
    playbook_execution_id: s(doc.playbookExecutionId),
    hint: s(doc.hint),
    overwrite_existing: doc.overwriteExisting === true,
    total_files: n(doc.totalFiles),
    classified_files: n(doc.classifiedFiles),
    error: s(doc.error),
    started_at: d(doc.startedAt),
    finished_at: d(doc.finishedAt),
    triggered_by: hexId(doc.triggeredBy, 'triggeredBy', id),
    ...stamps(doc),
  };
};

const missingWorkspace = (row: Row, refs: ClassifierRefs): string | null =>
  refs.workspaces.has(String(row.workspace_id)) ? null : `dangling workspace_id ${row.workspace_id} (workspace gone from PG; FK would reject)`;
const missingUser = (id: unknown, label: string, refs: ClassifierRefs): string | null =>
  refs.users.has(String(id)) ? null : `dangling ${label} ${id} (user gone from PG; FK would reject)`;

export const validateAssignment = (row: Row, refs: ClassifierRefs): string | null =>
  missingWorkspace(row, refs)
  ?? (refs.documents.has(String(row.document_id)) ? null : `dangling document_id ${row.document_id} (document gone from PG; FK would reject)`)
  ?? missingUser(row.assigned_by, 'assigned_by', refs);

export const validateRule = (row: Row, refs: ClassifierRefs): string | null => {
  const text = String(row.text);
  if (row.scope !== 'global' && row.scope !== 'local') return `scope ${row.scope} is neither global nor local`;
  if ((row.scope === 'global') !== (row.workspace_id === null)) return `a ${row.scope} rule ${row.workspace_id === null ? 'without' : 'with'} a workspace is inconsistent`;
  if (text.length < 1 || text.length > 1000) return `text length ${text.length} is outside 1..1000`;
  return missingUser(row.user_id, 'user_id', refs) ?? (row.workspace_id === null ? null : missingWorkspace({ workspace_id: row.workspace_id }, refs));
};

export const validateRun = (row: Row, refs: ClassifierRefs): string | null =>
  missingWorkspace(row, refs)
  ?? missingUser(row.triggered_by, 'triggered_by', refs)
  ?? (refs.playbooks.has(String(row.playbook_id)) ? null : `dangling playbook_id ${row.playbook_id} (playbook gone from PG; FK would reject)`);

/**
 * Folder tree. The cursor visits folders by `_id`, but a folder can have been moved below a
 * later-created one, so a child may come before its parent. `validate` walks the parent chain
 * (every ancestor must itself be valid and in the same workspace) and `insert` writes the missing
 * ancestors first; the ancestors are then skipped as already migrated when the cursor reaches them.
 */
export class FolderPlan {
  private readonly rows = new Map<string, Row>();
  private readonly verdicts = new Map<string, string | null>();

  constructor(docs: MongoDoc[], private readonly refs: ClassifierRefs) {
    for (const doc of docs) {
      try {
        const row = buildFolder(doc);
        this.rows.set(String(row.id), row);
      } catch {
        // A folder that cannot be built is reported by the cursor pass; it has no place in the tree.
      }
    }
  }

  validate = (row: Row): string | null => this.verdictOf(String(row.id), new Set());

  private verdictOf(id: string, visiting: Set<string>): string | null {
    if (this.verdicts.has(id)) return this.verdicts.get(id) ?? null;
    const row = this.rows.get(id);
    if (!row) return `parent folder ${id} does not exist in Mongo`;
    if (visiting.has(id)) return `folder ${id} is part of a cycle`;
    visiting.add(id);
    const name = String(row.name);
    const description = String(row.description);
    let verdict: string | null =
      missingWorkspace(row, this.refs)
      ?? missingUser(row.created_by, 'created_by', this.refs)
      ?? (name.length < 1 || name.length > 100 ? `name length ${name.length} is outside 1..100` : null)
      ?? (description.length < 1 || description.length > 1000 ? `description length ${description.length} is outside 1..1000` : null);
    if (!verdict && row.parent_id) {
      const parentId = String(row.parent_id);
      const parent = this.rows.get(parentId);
      if (parent && parent.workspace_id !== row.workspace_id) {
        verdict = `parent folder ${parentId} belongs to another workspace`;
      } else {
        const parentVerdict = this.verdictOf(parentId, visiting);
        if (parentVerdict) verdict = `parent folder ${parentId} cannot be migrated (${parentVerdict})`;
      }
    }
    visiting.delete(id);
    this.verdicts.set(id, verdict ?? null);
    return verdict ?? null;
  }

  /** Inserts the folder after its missing ancestors. */
  async insert(pool: Queryable, row: Row): Promise<void> {
    if (row.parent_id) {
      const parentId = String(row.parent_id);
      const present = (await pool.query('SELECT 1 FROM classifier.folders WHERE id = $1', [parentId])) as { rowCount: number | null };
      const parent = this.rows.get(parentId);
      if (!present.rowCount && parent) await this.insert(pool, parent);
    }
    await insertRow(pool, 'classifier.folders', FOLDER_COLUMNS, row);
  }
}

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    columns.map((c) => row[c]),
  );
}

/**
 * An assignment whose folder or run no longer exists keeps its file but loses that reference,
 * exactly what the ON DELETE SET NULL foreign keys do (a folder going away also resets the source
 * to manual). Absent from `existing*` means absent from Postgres.
 */
export async function insertAssignment(pool: Queryable, row: Row, existingFolders: ReadonlySet<string>, existingRuns: ReadonlySet<string>): Promise<void> {
  const folderGone = row.folder_id !== null && !existingFolders.has(String(row.folder_id));
  const runGone = row.classification_run_id !== null && !existingRuns.has(String(row.classification_run_id));
  await insertRow(pool, 'classifier.file_assignments', ASSIGNMENT_COLUMNS, {
    ...row,
    folder_id: folderGone ? null : row.folder_id,
    assignment_source: folderGone ? 'manual' : row.assignment_source,
    classification_run_id: runGone ? null : row.classification_run_id,
  });
}
