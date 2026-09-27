/**
 * A workspace mapping applies one document mapping to every readable file of a workspace (or of one of
 * its folders), including files added later. It is stored as a single mapping row whose document id is a
 * workspace key; the files it covers are resolved each time data is generated.
 */
export const WORKSPACE_MAPPING_PREFIX = 'workspace:';
/** Files one workspace mapping may cover in a single run. */
export const MAX_WORKSPACE_MAPPING_DOCUMENTS = 5000;

export type SourceMappingScope = 'document' | 'workspace';

export const workspaceMappingKey = (workspaceId: string, folderId?: string | null) =>
  `${WORKSPACE_MAPPING_PREFIX}${workspaceId}:${folderId || 'all'}`;

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

/** The files a workspace mapping covers: readable documents, inside the folder when one is chosen. */
export function workspaceMappingFiles<T extends WorkspaceFileCandidate>(
  all: T[],
  documentMimeTypes: ReadonlySet<string>,
  folderId?: string | null,
): WorkspaceMappingFiles<T> {
  const parents = new Map(all.map((item) => [item.id, item.parentId ?? null]));
  const inFolder = (item: T) => {
    if (!folderId) return true;
    const seen = new Set<string>();
    let parent = item.parentId ?? null;
    while (parent && !seen.has(parent)) {
      if (parent === folderId) return true;
      seen.add(parent);
      parent = parents.get(parent) ?? null;
    }
    return false;
  };
  const candidates = all
    .filter((item) => !item.isFolder && documentMimeTypes.has(item.mimeType) && inFolder(item))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    readable: candidates.filter((item) => READY_INDEXING.has(String(item.indexingStatus ?? ''))),
    waiting: candidates.filter((item) => !READY_INDEXING.has(String(item.indexingStatus ?? ''))),
  };
}
