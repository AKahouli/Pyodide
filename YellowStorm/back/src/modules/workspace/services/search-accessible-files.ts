import type { WorkspaceService } from '../workspace.service';
import type { WorkspaceShareService } from '../workspace-share.service';
import type { WorkspaceDocumentService } from '../workspace-document.service';

export interface AccessibleFileMatch {
  id: string;
  name: string;
  mimeType: string;
  workspaceId: string;
  workspaceName: string;
  folderName: string | null;
}

export const MIN_FILE_SEARCH = 2;

/**
 * Files whose name matches, across every workspace the person can open (their own and the shared
 * ones), with the workspace and folder each one sits in. Folders are not returned.
 */
export async function searchAccessibleFiles(
  services: { workspaces: WorkspaceService; workspaceShares: WorkspaceShareService; documents: WorkspaceDocumentService },
  userId: string,
  search: string,
  page = 1,
): Promise<{ files: AccessibleFileMatch[]; page: number; totalPages: number }> {
  const term = search.trim();
  if (term.length < MIN_FILE_SEARCH) return { files: [], page: 1, totalPages: 1 };
  const [own, shared] = await Promise.all([
    services.workspaces.findAllByUser(userId, { page: 1, limit: 100 }),
    services.workspaceShares.findSharedWithUser(userId, { page: 1, limit: 100 }).catch(() => ({ workspaces: [] })),
  ]);
  const names = new Map<string, string>();
  for (const workspace of [...own.workspaces, ...(shared.workspaces as { id: string; name: string }[])]) names.set(workspace.id, workspace.name);
  if (!names.size) return { files: [], page: 1, totalPages: 1 };
  const result = await services.documents.findByMultipleWorkspaces([...names.keys()], { page, limit: 50, search: term, sortBy: 'originalName', sortOrder: 'asc' } as never);
  const files = result.documents.filter((document) => !document.isFolder);
  const parents = new Map<string, Promise<string | null>>();
  const folderName = (workspaceId: string, parentId?: string | null) => {
    if (!parentId) return Promise.resolve(null);
    if (!parents.has(parentId)) {
      parents.set(parentId, services.documents.findById(workspaceId, parentId).then((folder) => folder.folderName || folder.originalName).catch(() => null));
    }
    return parents.get(parentId)!;
  };
  return {
    files: await Promise.all(files.map(async (document) => ({
      id: document.id,
      name: document.originalName,
      mimeType: document.mimeType,
      workspaceId: document.workspaceId,
      workspaceName: names.get(document.workspaceId) ?? '',
      folderName: await folderName(document.workspaceId, document.parentId),
    }))),
    page: result.pagination.page,
    totalPages: result.pagination.totalPages,
  };
}
