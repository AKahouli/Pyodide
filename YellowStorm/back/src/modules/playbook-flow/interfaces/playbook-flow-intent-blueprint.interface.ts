import type { PlaybookIntentDiagnostic } from './playbook-flow-intent-diagnostic.interface';

export interface PlaybookIntentBlueprintPort {
  id: string;
  name?: string | null;
  artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
  required?: boolean;
}

export type PlaybookIntentBlueprintVersion = 1 | 2;
export type PlaybookIntentBlueprintEdgeKind = 'sequential' | 'conditional';
export type PlaybookIntentPrimitiveKind =
  | 'agent'
  | 'action'
  | 'evaluation'
  | 'iterator'
  | 'router'
  | 'human_approval'
  | string;

export interface PlaybookIntentBlueprintRouterCondition {
  label: string;
  sourceRef: string;
  sourceIteratorRef?: string | null;
  sourcePort: string;
  path?: string | null;
  operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
  value?: unknown;
}

export interface PlaybookIntentBlueprintRouterConfig {
  outputLabels: string[];
  maxIterations?: number | null;
  conditions?: PlaybookIntentBlueprintRouterCondition[];
  defaultLabel?: string | null;
}

export interface PlaybookIntentBlueprintPrimitiveConfig {
  kind: PlaybookIntentPrimitiveKind;
  router?: PlaybookIntentBlueprintRouterConfig;
  iterator?: Record<string, unknown>;
  humanApproval?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  action?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PlaybookIntentBlueprintIteratorStep {
  ref: string;
  title: string;
  description?: string;
  nodeTemplateKey: string;
  agentHint?: string | null;
  connectorRefs?: PlaybookIntentBlueprintConnectorRef[];
  skillRefs?: PlaybookIntentBlueprintSkillRef[];
  primitive?: PlaybookIntentBlueprintPrimitiveConfig;
  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];
}

export interface PlaybookIntentBlueprintIteratorBody {
  steps: PlaybookIntentBlueprintIteratorStep[];
  edges: Array<{
    sourceRef: string;
    targetRef: string;
    kind?: PlaybookIntentBlueprintEdgeKind;
    routerLabel?: string | null;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
  }>;
}

export interface PlaybookIntentBlueprintNode {
  ref: string;
  label: string;
  purpose: string;
  nodeTemplateKey: string;
  agentHint?: string | null;
  primitive?: PlaybookIntentBlueprintPrimitiveConfig;
  routerConfig?: PlaybookIntentBlueprintRouterConfig;
  humanApprovalConfig?: Record<string, unknown>;
  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];
  connectorRefs?: PlaybookIntentBlueprintConnectorRef[];
  skillRefs?: PlaybookIntentBlueprintSkillRef[];
  iteratorBody?: PlaybookIntentBlueprintIteratorBody;
  anchor?: {
    mode?: 'append' | 'before' | 'after' | 'as_input';
    targetTaskId?: string | null;
    targetRef?: string | null;
  };
}

export interface PlaybookIntentBlueprintConnectorRef {
  connectorSlug: string;
  actionKey: string;
  reason?: string | null;
}

export interface PlaybookIntentBlueprintSkillRef {
  skillSlug: string;
  reason?: string | null;
}

export interface PlaybookIntentBlueprintLink {
  sourceRef: string;
  targetRef: string;
  sourceIteratorRef?: string | null;
  targetIteratorRef?: string | null;
  kind?: PlaybookIntentBlueprintEdgeKind;
  routerLabel?: string | null;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
  priority?: number | null;
}

export interface PlaybookIntentBlueprintBinding {
  targetRef: string;
  targetIteratorRef?: string | null;
  targetPort: string;
  sourceKind: 'node-output' | 'constant';
  sourceRef?: string | null;
  sourceIteratorRef?: string | null;
  sourcePort?: string | null;
  iteration?: 'current' | 'previous';
  constantValue?: {
    kind: 'workspace' | 'document';
    id: string;
    workspaceId: string;
    documentId?: string;
    workspaceName?: string;
    path?: string;
    mimeType?: string;
    label?: string;
  };
}

export interface PlaybookIntentBlueprint {
  version?: PlaybookIntentBlueprintVersion;
  title: string;
  summary: string;
  nodes: PlaybookIntentBlueprintNode[];
  links: PlaybookIntentBlueprintLink[];
  bindings?: PlaybookIntentBlueprintBinding[];
  assumptions?: string[];
  riskFlags?: string[];
}

export interface PlaybookIntentBlueprintParseResult {
  blueprint: PlaybookIntentBlueprint;
  diagnostics: PlaybookIntentDiagnostic[];
}
