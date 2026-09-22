import type { WorkspaceShareRecord } from './workspace-records';

export const WORKSPACE_SHARE_READ_PORT = Symbol('WORKSPACE_SHARE_READ_PORT');

export interface WorkspaceShareReadPort {
  findForUser(userId: string): Promise<WorkspaceShareRecord[]>;
  findForWorkspace(workspaceId: string): Promise<WorkspaceShareRecord[]>;
  /** null when no share exists for the user. */
  permissionFor(workspaceId: string, userId: string): Promise<'read' | 'readwrite' | null>;
}
