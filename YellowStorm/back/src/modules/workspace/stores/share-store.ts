import type { WorkspaceShareRecord } from '../ports/workspace-records';

export const SHARE_STORE = Symbol('SHARE_STORE');

export interface ShareCreateInput {
  workspaceId: string;
  ownerId: string;
  sharedWithUserId: string;
  permission: 'read' | 'readwrite';
  sharedBy: string;
}

export interface SharePage {
  items: WorkspaceShareRecord[];
  total: number;
}

/** Internal write/read store for the workspace_shares aggregate (plan D.5). */
export interface ShareStore {
  findById(shareId: string): Promise<WorkspaceShareRecord | null>;
  /** Page for the owner view, newest first. */
  findForWorkspace(workspaceId: string, skip: number, limit: number): Promise<SharePage>;
  /** Page of shares targeting `userId`, newest first (shared-with view). */
  findSharedWithUser(userId: string, skip: number, limit: number): Promise<SharePage>;
  findOneByWorkspaceAndUser(workspaceId: string, userId: string): Promise<WorkspaceShareRecord | null>;
  /** IDs from `ids` shared with `userId` (access checks). */
  filterSharedWithUser(userId: string, ids: string[]): Promise<string[]>;
  create(input: ShareCreateInput): Promise<WorkspaceShareRecord>;
  updatePermission(shareId: string, permission: 'read' | 'readwrite'): Promise<void>;
  deleteById(shareId: string): Promise<void>;
  /** Returns the number of deleted shares. */
  deleteManyByWorkspace(workspaceId: string): Promise<number>;
}
