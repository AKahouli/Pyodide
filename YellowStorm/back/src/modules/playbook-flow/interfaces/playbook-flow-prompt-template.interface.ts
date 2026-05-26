export interface FlowPromptTemplateResponse {
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

export interface FlowPromptTemplateListResponse {
  items: FlowPromptTemplateResponse[];
}

export interface UpsertFlowPromptTemplateRequest {
  title: string;
  category: string;
  description?: string;
  systemTemplate?: string;
  userTemplate?: string;
  enabled?: boolean;
}
