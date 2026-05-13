export interface PlaybookPromptTemplateResponse {
  id: string;
  key: string;
  title: string;
  category: string;
  description?: string;
  systemTemplate: string;
  userTemplate: string;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPlaybookPromptTemplateRequest {
  title: string;
  category: string;
  description?: string;
  systemTemplate?: string;
  userTemplate?: string;
  enabled?: boolean;
}

export interface PlaybookPromptTemplateListResponse {
  items: PlaybookPromptTemplateResponse[];
}
