export interface ReplayReasoningStage {
  stageKey: string;
  stageType: string;
  label: string;
  description: string;
  confidence?: number | null;
}

export interface ReplayContextVariable {
  key: string;
  label: string;
  source: 'task' | 'input_context' | 'tool_args' | 'unknown';
  valueType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
  required: boolean;
  exampleValue?: string | null;
}

export interface ReplayToolTraceTemplateItem {
  stepIndex: number;
  toolName: string;
  purpose: string;
  argumentShape: Record<string, unknown>;
  required: boolean;
}

export interface ReplayDriftPolicy {
  requireSameIntent: boolean;
  requireSameReasoningStages: boolean;
  requireSameToolOrder: boolean;
  allowAdditionalTools: boolean;
  allowArgumentValueChanges: boolean;
  enforceOutputContract: boolean;
}

export interface ReplayAcceptedExample {
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  summary: string;
  outputPreview?: string | null;
}

export interface ReplaySemanticChecklistItem {
  key: string;
  description: string;
  variables: string[];
  severity: 'info' | 'warning' | 'fail';
  source: 'intent' | 'reasoning' | 'quality_check' | 'output_contract' | 'context';
}
