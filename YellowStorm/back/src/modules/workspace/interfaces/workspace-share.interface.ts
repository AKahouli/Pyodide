export type WorkspacePermission = 'read' | 'readwrite';

export interface SharedUserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface WorkspaceShareResponse {
  id: string;
  workspaceId: string;
  user: SharedUserInfo;
  permission: WorkspacePermission;
  sharedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareWorkspaceResult {
  shared: WorkspaceShareResponse[];
  notFound: string[];
  invalid: string[];
}

export interface PaginatedShares {
  shares: WorkspaceShareResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SharedWorkspaceOwnerInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface SharedWorkspaceResponse {
  id: string;
  name: string;
  alias: string;
  description?: string;
  owner: SharedWorkspaceOwnerInfo;
  permission: WorkspacePermission;
  shareId: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  sharedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSharedWorkspaces {
  workspaces: SharedWorkspaceResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
