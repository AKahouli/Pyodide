import type { WorkspaceSettingRecord } from '../ports/workspace-records';

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

