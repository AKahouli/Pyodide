export type PlaybookPermissionLevel = 'read' | 'write' | 'owner';
export type AssignablePlaybookPermission = Exclude<PlaybookPermissionLevel, 'owner'>;

export interface IPlaybookShareUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface IPlaybookShareEntry {
  shareId: string;
  permission: AssignablePlaybookPermission;
  user: IPlaybookShareUser;
  createdAt: Date;
}

export interface ISharedPlaybookInfo {
  shareId: string;
  permission: AssignablePlaybookPermission;
  sharedBy: IPlaybookShareUser;
}
