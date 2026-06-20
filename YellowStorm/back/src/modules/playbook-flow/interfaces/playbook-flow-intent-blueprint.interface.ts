export type PlaybookIntentBlueprintNodeKind =
  | 'agent'
  | 'action'
  | 'evaluation'
  | 'iterator'
  | 'router'
  | 'human_approval';

export interface PlaybookIntentBlueprintPort {
  id: string;
  name?: string | null;
  artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
  required?: boolean;
}

export interface PlaybookIntentBlueprintIteratorStep {
  ref: string;
  title: string;
  description?: string;
  templateType?: string | null;
  nodeType?: PlaybookIntentBlueprintNodeKind;
  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];
}

export interface PlaybookIntentBlueprintIteratorBody {
  steps: PlaybookIntentBlueprintIteratorStep[];
  edges: Array<{
    sourceRef: string;
    targetRef: string;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
  }>;
}

export interface PlaybookIntentBlueprintNode {
  ref: string;
  label: string;
  purpose: string;
  templateType?: string | null;
  nodeType?: PlaybookIntentBlueprintNodeKind;
  agentHint?: string | null;
  inputPorts?: PlaybookIntentBlueprintPort[];
  outputPorts?: PlaybookIntentBlueprintPort[];
  iteratorBody?: PlaybookIntentBlueprintIteratorBody;
  anchor?: {
    mode?: 'append' | 'before' | 'after' | 'as_input';
    targetTaskId?: string | null;
    targetRef?: string | null;
  };
}

export interface PlaybookIntentBlueprintLink {
  sourceRef: string;
  targetRef: string;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
}

export interface PlaybookIntentBlueprintBinding {
  targetRef: string;
  targetPort: string;
  sourceKind: 'node-output' | 'constant';
  sourceRef?: string | null;
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
  dropped: Array<{ rule: string; itemId: string }>;
}
