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
  conditions?: {
    label: string;
    sourceNode?: string | null;
    sourcePort?: string | null;
    path?: string | null;
    operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';
    value?: unknown;
  }[];
  defaultLabel?: string | null;
  mode?: 'ai' | 'deterministic' | null;
  prompt?: string | null;
}

export interface FlowNodeTemplateHumanApprovalConfig {
  promptTemplate: string;
  timeoutSeconds?: number | null;
}

export interface FlowNodeTemplateRetryPolicy {
  maxRetries: number;
  delayMs?: number;
}

export interface FlowNodeTemplateResponse {
  id: string;
  key: string;
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
  assignedAgentId: string | null;
  selectedAction: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  retryPolicy?: FlowNodeTemplateRetryPolicy | null;
  modelId?: string | null;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowNodeTemplateListResponse {
  items: FlowNodeTemplateResponse[];
}

export interface FlowNodeTemplateImportPayload {
  version: 1;
  type: 'playbook-node-templates';
  items: (CreateFlowNodeTemplateRequest & { enabled?: boolean; isBuiltIn?: boolean })[];
}

export interface CreateFlowNodeTemplateRequest {
  key: string;
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
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  retryPolicy?: FlowNodeTemplateRetryPolicy | null;
  modelId?: string | null;
  enabled?: boolean;
}

export interface UpdateFlowNodeTemplateRequest {
  key?: string;
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
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: FlowNodeTemplateIteratorConfig | null;
  routerConfig?: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | null;
  retryPolicy?: FlowNodeTemplateRetryPolicy | null;
  modelId?: string | null;
  enabled?: boolean;
}
