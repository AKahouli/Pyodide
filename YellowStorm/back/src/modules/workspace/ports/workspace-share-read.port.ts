import type { WorkspaceShareRecord } from './workspace-records';


export interface WorkspaceShareReadPort {
  findForUser(userId: string): Promise<WorkspaceShareRecord[]>;
  findForWorkspace(workspaceId: string): Promise<WorkspaceShareRecord[]>;
  /** null when no share exists for the user. */
  permissionFor(workspaceId: string, userId: string): Promise<'read' | 'readwrite' | null>;
}
