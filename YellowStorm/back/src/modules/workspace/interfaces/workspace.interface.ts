export interface CreateWorkspaceData {
  name: string;
  description?: string;
  settings?: string;
}

export interface UpdateWorkspaceData {
  name?: string;
  description?: string;
  settings?: string | null; // null to clear settings
}

export interface WorkspaceQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  alias: string;
  description?: string;
  createdBy: string;
  settings?: string;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  isSystem: boolean;
  isPersonal: boolean;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedWorkspaces {
  workspaces: WorkspaceResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
