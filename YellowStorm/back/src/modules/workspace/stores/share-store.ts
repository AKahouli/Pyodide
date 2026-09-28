import type { WorkspaceShareRecord } from '../ports/workspace-records';

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

