import type { PlaybookIteratorConfigData } from './playbook.interface';

export interface PlaybookNodeTemplatePort {
  id: string;
  name: string;
  artifactKind: string;
  required?: boolean;
  description?: string;
}

export interface PlaybookNodeTemplateResponse {
  id: string;
  key: string;
  type: string;
  nodeType: 'agent' | 'action' | 'evaluation' | 'iterator';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: PlaybookNodeTemplatePort[];
  outputPorts: PlaybookNodeTemplatePort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  executionMode: string;
  assignedAgentId: string | null;
  selectedAction: string | null;
  iteratorConfig?: PlaybookIteratorConfigData | null;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookNodeTemplateListResponse {
  items: PlaybookNodeTemplateResponse[];
}

export interface CreatePlaybookNodeTemplateRequest {
  key: string;
  type: string;
  nodeType: 'agent' | 'action' | 'evaluation' | 'iterator';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: PlaybookNodeTemplatePort[];
  outputPorts: PlaybookNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: PlaybookIteratorConfigData | null;
  enabled?: boolean;
}

export interface UpdatePlaybookNodeTemplateRequest {
  key?: string;
  type?: string;
  nodeType?: 'agent' | 'action' | 'evaluation' | 'iterator';
  title?: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  inputPorts?: PlaybookNodeTemplatePort[];
  outputPorts?: PlaybookNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: PlaybookIteratorConfigData | null;
  enabled?: boolean;
}
