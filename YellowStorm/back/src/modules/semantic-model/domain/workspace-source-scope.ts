import { createHash } from 'node:crypto';

/**
 * A workspace mapping applies one document mapping to many files of a workspace: all of them, or the
 * folders and files someone picked. Files added later to the workspace (or to a picked folder) are
 * included. It is stored as a single mapping row whose document id is a workspace key; the files it
 * covers are resolved each time data is generated.
 */
export const WORKSPACE_MAPPING_PREFIX = 'workspace:';
/** Files one workspace mapping may cover in a single run. */
export const MAX_WORKSPACE_MAPPING_DOCUMENTS = 5000;
/** Folders and files one workspace mapping may name. */
export const MAX_WORKSPACE_SELECTION_ITEMS = 500;

export type SourceMappingScope = 'document' | 'workspace';

/** Picked folders (every file inside, at any depth) and single files. Null means the whole workspace. */
export interface WorkspaceSelection {
  folderIds: string[];
  documentIds: string[];
}

/** Sorted, without repeats; nothing picked means the whole workspace. */
export function normalizeWorkspaceSelection(folderIds: readonly string[] = [], documentIds: readonly string[] = []): WorkspaceSelection | null {
  const folders = [...new Set(folderIds.filter(Boolean))].sort();
  const documents = [...new Set(documentIds.filter(Boolean))].sort();
  return folders.length || documents.length ? { folderIds: folders, documentIds: documents } : null;
}

/** What a stored mapping covers: its selection, or the single folder older mappings kept. */
export function mappingSelection(row: { folderId?: string | null; selection?: Partial<WorkspaceSelection> | null }): WorkspaceSelection | null {
  if (row.selection) return normalizeWorkspaceSelection(row.selection.folderIds ?? [], row.selection.documentIds ?? []);
  return row.folderId ? { folderIds: [row.folderId], documentIds: [] } : null;
}

const asSelection = (scope?: WorkspaceSelection | string | null): WorkspaceSelection | null =>
  typeof scope === 'string' ? { folderIds: [scope], documentIds: [] } : scope ?? null;

/** The mapping's document key. A whole workspace or one folder keep a readable key; other picks are hashed. */
export function workspaceMappingKey(workspaceId: string, scope?: WorkspaceSelection | string | null): string {
  const selection = asSelection(scope);
  if (!selection || (!selection.folderIds.length && !selection.documentIds.length)) return `${WORKSPACE_MAPPING_PREFIX}${workspaceId}:all`;
  if (selection.folderIds.length === 1 && !selection.documentIds.length) return `${WORKSPACE_MAPPING_PREFIX}${workspaceId}:${selection.folderIds[0]}`;
  const normalized = normalizeWorkspaceSelection(selection.folderIds, selection.documentIds);
  const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return `${WORKSPACE_MAPPING_PREFIX}${workspaceId}:pick-${digest.slice(0, 16)}`;
}

export const isWorkspaceMappingKey = (documentId: string) => documentId.startsWith(WORKSPACE_MAPPING_PREFIX);

export interface WorkspaceFileCandidate {
  id: string;
  mimeType: string;
  isFolder: boolean;
  parentId?: string | null;
  indexingStatus?: string;
}

export interface WorkspaceMappingFiles<T extends WorkspaceFileCandidate> {
  /** Files that can be read now, sorted by id so every run sees them in the same order. */
  readable: T[];
  /** Files of a readable type that are still being indexed; they are read once indexing finishes. */
  waiting: T[];
}

const READY_INDEXING = new Set(['ready', 'completed']);

/** The files a workspace mapping covers: readable documents of the workspace, or of the picked folders and files. */
export function workspaceMappingFiles<T extends WorkspaceFileCandidate>(
  all: T[],
  documentMimeTypes: ReadonlySet<string>,
  scope?: WorkspaceSelection | string | null,
): WorkspaceMappingFiles<T> {
  const selection = asSelection(scope);
  const folders = new Set(selection?.folderIds ?? []);
  const documents = new Set(selection?.documentIds ?? []);
  const parents = new Map(all.map((item) => [item.id, item.parentId ?? null]));
  const covered = (item: T) => {
    if (!selection) return true;
    if (documents.has(item.id)) return true;
    const seen = new Set<string>();
    let parent = item.parentId ?? null;
    while (parent && !seen.has(parent)) {
      if (folders.has(parent)) return true;
      seen.add(parent);
      parent = parents.get(parent) ?? null;
    }
    return false;
  };
  const candidates = all
    .filter((item) => !item.isFolder && documentMimeTypes.has(item.mimeType) && covered(item))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    readable: candidates.filter((item) => READY_INDEXING.has(String(item.indexingStatus ?? ''))),
    waiting: candidates.filter((item) => !READY_INDEXING.has(String(item.indexingStatus ?? ''))),
  };
}
