import type { ControlEdge, DataBinding, FlowNode } from '../models/playbook-flow.model';
import type { PlaybookIntentSuggestion } from '../services/playbook-flow-intent.service';

export interface PlaybookAssistantDiagnostic {
  rule: number;
  message: string;
}

export interface PlaybookAssistantContextEnvelope {
  contextId: string;
  playbookId: string;
  definitionRevision: number;
  generatedAt: string;
  access: {
    level: 'read' | 'write' | 'owner';
    canUpdate: boolean;
    canExecute: boolean;
  };
  workflow: {
    name: string;
    description: string;
    taskCount: number;
    edgeCount: number;
    bindingCount: number;
    workspaceIds: string[];
    triggerSummary: string[];
  };
  graph: {
    tasks: FlowNode[];
    controlEdges: ControlEdge[];
    dataBindings: DataBinding[];
  };
  selectedTask: FlowNode | null;
  validation: {
    status: 'valid' | 'valid_with_warnings' | 'blocked';
    diagnostics: PlaybookAssistantDiagnostic[];
  };
  execution: {
    executionId: string | null;
    status: string | null;
    waitingForHumanInput: boolean;
    currentInterruptId: string | null;
    currentInterruptTaskId: string | null;
  };
}

export interface PlaybookTaskDependenciesResult {
  playbookId: string;
  taskId: string;
  upstreamTaskIds: string[];
  downstreamTaskIds: string[];
  incomingBindings: DataBinding[];
  outgoingBindings: DataBinding[];
}

export interface PlaybookTaskOptimizationResult {
  playbookId: string;
  taskId: string;
  definitionRevision: number;
  dimensions: string[];
  findings: { dimension: string; severity: 'info' | 'warning'; message: string }[];
  evidence: { validationDiagnostics: PlaybookAssistantDiagnostic[]; remediationItems: unknown[] };
  mutationApplied: false;
}

export interface PreparedConstructionInput {
  flowId: string;
  ownerId: string;
  baseDefinitionRevision: number;
  suggestions: PlaybookIntentSuggestion[];
  applyTarget?: 'current_playbook' | 'new_playbook';
}
