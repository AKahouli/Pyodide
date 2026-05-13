import { RagType } from '../schemas/workspace-setting.schema';

export interface CreateWorkspaceSettingData {
  name: string;
  description?: string;
  tag?: string;
  /** @deprecated No longer used for indexing. Kept for backward compatibility. */
  model?: string;
  isTemplate?: boolean;
  isPredefined?: boolean;
  instruction?: string;
  chunks?: number;
  hybridSearch?: boolean;
  ragType?: RagType;
  maxToken?: number;
  topK?: number;
}

export interface UpdateWorkspaceSettingData {
  name?: string;
  description?: string;
  tag?: string;
  /** @deprecated No longer used for indexing. Kept for backward compatibility. */
  model?: string;
  isTemplate?: boolean;
  instruction?: string;
  chunks?: number;
  hybridSearch?: boolean;
  ragType?: RagType;
  maxToken?: number;
  topK?: number;
}

export interface WorkspaceSettingQueryParams {
  page?: number;
  limit?: number;
  tag?: string;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkspaceSettingResponse {
  id: string;
  name: string;
  description?: string;
  tag?: string;
  /** @deprecated No longer used for indexing. Kept for backward compatibility. */
  model?: string;
  isTemplate: boolean;
  isPredefined: boolean;
  createdBy: string;
  instruction?: string;
  chunks: number;
  hybridSearch: boolean;
  ragType: RagType;
  maxToken: number;
  topK: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedWorkspaceSettings {
  settings: WorkspaceSettingResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
