import type { PlaybookIntentDiagnostic } from './playbook-flow-intent-diagnostic.interface';

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
  nodeTemplateKey: string;
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
  nodeTemplateKey: string;
  agentHint?: string | null;
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
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
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
