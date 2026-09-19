import type { WorkspaceSettingRecord } from '../ports/workspace-records';

export const SETTING_STORE = Symbol('SETTING_STORE');

export interface SettingCreateInput {
  name: string;
  description?: string;
  tag?: string;
  llmModel?: string;
  isTemplate: boolean;
  isPredefined: boolean;
  createdBy: string;
  instruction?: string;
  chunks: number;
  hybridSearch: boolean;
  ragType: string;
  maxToken: number;
  topK: number;
}

export interface SettingListParams {
  tag?: string;
  search?: string;
  skip: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

/** Patch for updateFields: only explicitly present keys are written. */
export interface SettingUpdatePatch {
  name?: string;
  description?: string;
  tag?: string;
  llmModel?: string;
  isTemplate?: boolean;
  instruction?: string;
  chunks?: number;
  hybridSearch?: boolean;
  ragType?: string;
  maxToken?: number;
  topK?: number;
}

/** Internal write/read store for the workspace_settings aggregate (plan D.5). */
export interface SettingStore {
  create(input: SettingCreateInput): Promise<WorkspaceSettingRecord>;
  findById(id: string): Promise<WorkspaceSettingRecord | null>;
  listByUser(userId: string, params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }>;
  listTemplates(params: SettingListParams): Promise<{ items: WorkspaceSettingRecord[]; total: number }>;
  updateFields(id: string, patch: SettingUpdatePatch): Promise<void>;
  deleteById(id: string): Promise<void>;
}
