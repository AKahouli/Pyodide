export interface FlowNodeTemplatePort {
  id: string;
  name: string;
  artifactKind: string;
  required?: boolean;
  description?: string;
}

export interface FlowNodeTemplateIteratorConfig {
  source: string;
  mode: 'item' | 'batch';
  batchSize?: number | null;
  itemVariable?: string | null;
  outputVariable?: string | null;
  errorStrategy?: 'stop' | 'continue';
}

export interface FlowNodeTemplateRouterConfig {
  outputLabels: string[];
  maxIterations: number;
}

export interface FlowNodeTemplateHumanApprovalConfig {
  promptTemplate: string;
  timeoutSeconds?: number | null;
}

export interface FlowNodeTemplateResponse {
  id: string;
  key: string;
  type: string;
  nodeType: 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: FlowNodeTemplatePort[];
  outputPorts: FlowNodeTemplatePort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  executionMode: string;
  assignedAgentId: string | null;
  selectedAction: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowNodeTemplateListResponse {
  items: FlowNodeTemplateResponse[];
}

export interface CreateFlowNodeTemplateRequest {
  key: string;
  type: string;
  nodeType: 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: FlowNodeTemplatePort[];
  outputPorts: FlowNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  enabled?: boolean;
}

export interface UpdateFlowNodeTemplateRequest {
  key?: string;
  type?: string;
  nodeType?: 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';
  title?: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  inputPorts?: FlowNodeTemplatePort[];
  outputPorts?: FlowNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  enabled?: boolean;
}
