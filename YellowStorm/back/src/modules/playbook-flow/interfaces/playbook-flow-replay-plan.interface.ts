import type {
  ReplayContextVariable,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
  ReplayToolTraceTemplateItem,
} from './playbook-flow-replay-template.interface';
import type { FlowReplayToolCall } from '../models/playbook-flow-validated-replay.model';

export type ReplayContextMappingSource =
  | ReplayContextVariable['source']
  | 'task_title'
  | 'task_description'
  | 'task_text';

export interface ReplayContextMappingEntry {
  variableKey: string;
  key: string;
  label: string;
  source: ReplayContextMappingSource;
  valueType: ReplayContextVariable['valueType'];
  required: boolean;
  baselineValue: string | null;
  currentValue: string | number | boolean | Record<string, unknown> | unknown[] | null;
  confidence: number;
  reason: string;
  value: string | number | boolean | Record<string, unknown> | unknown[] | null;
  matched: boolean;
}

export interface ReplayPlanToolStep {
  stepIndex: number;
  toolName: string;
  purpose: string;
  required: boolean;
  argumentShape: Record<string, unknown>;
  argumentShapeKeys: string[];
  expectedArgs: Record<string, unknown>;
  sourceCallIndex?: number | null;
}

export interface ReplayToolCallComparison {
  expectedStepIndex: number | null;
  expectedToolName: string | null;
  expectedPurpose: string | null;
  expectedArgs: Record<string, unknown>;
  observedCallIndex: number | null;
  observedToolName: string | null;
  observedPurpose?: string | null;
  observedArgs: Record<string, unknown>;
  status: 'matched' | 'warning' | 'failed' | 'missing' | 'extra';
  reasons: string[];
}

export interface ReplayToolEnforcementAssessment {
  toolPolicyScore: number | null;
  toolSequenceMatch: number | null;
  argumentShapeMatch: number | null;
  findings: { category: 'tool_sequence' | 'argument_shape'; severity: 'info' | 'warning' | 'fail'; reason: string }[];
  blockedBy: string[];
  comparisons: ReplayToolCallComparison[];
}

export interface ReplayExecutionPlan {
  taskId: string;
  replayId: string;
  validationVersion: number;
  intentKey: string | null;
  intentLabel: string | null;
  matchedContextCount: number;
  missingRequiredContextCount: number;
  requiredStageLabels: string[];
  requiredOutputChecks: string[];
  plannedToolSteps: ReplayPlanToolStep[];
  semanticChecklist: ReplaySemanticChecklistItem[];
}

export interface ReplayPlanningSummary {
  replayId: string;
  validationVersion: number;
  intentKey: string | null;
  intentLabel: string | null;
  contextMapping: ReplayContextMappingEntry[];
  executionPlan: ReplayExecutionPlan;
}

export interface BuildReplayPlanningInput {
  taskId: string;
  replayId: string;
  validationVersion: number;
  intentKey?: string | null;
  intentLabel?: string | null;
  contextVariableSchema?: ReplayContextVariable[];
  reasoningOutline?: ReplayReasoningStage[];
  toolTraceTemplate?: ReplayToolTraceTemplateItem[];
  semanticChecklist?: ReplaySemanticChecklistItem[];
  toolCalls?: FlowReplayToolCall[];
  outputFormatGuide?: string | null;
  outputContract?: {
    requiredSections?: string[];
    forbiddenSections?: string[];
    citationPolicy?: 'required' | 'optional' | 'forbidden';
    jsonSchema?: Record<string, unknown> | null;
  } | null;
  inputContext?: Record<string, unknown>;
  taskTitle?: string | null;
  taskDescription?: string | null;
}
