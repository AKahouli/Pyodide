import { ControlEdge, DataBinding } from './playbook-flow-graph.model';
import { DEFAULT_HITL_POLICY, HitlBlockerRule, HitlPolicy } from './playbook-flow-hitl.model';

export const ADVISOR_SCORING_MODES = ['llm', 'heuristic'] as const;
export type AdvisorScoringMode = (typeof ADVISOR_SCORING_MODES)[number];
export { ControlEdge, DataBinding } from './playbook-flow-graph.model';

export class FlowTriggerConfig {
  kind?: string;

  params?: Record<string, unknown>;
}

export class FlowSettings {
  recursionLimit!: number;

  maxParallelism!: number;
}

export class FlowNodePort {
  id!: string;

  label?: string;

  type?: string;

  required?: boolean;
}

export class FlowNodeInput {
  raw?: string;

  ports?: FlowNodePort[];
}

export class FlowNodeOutput {
  raw?: string;

  ports?: FlowNodePort[];
}

export class RouterCondition {
  label!: string;

  sourceNode?: string;

  sourcePort?: string;

  path?: string;

  operator!: string;

  value?: unknown;
}

export class RouterConfig {
  outputLabels!: string[];

  maxIterations!: number;

  conditions?: RouterCondition[];

  defaultLabel?: string;

  mode?: string;

  prompt?: string;
}

export class IteratorConfig {
  collectionPath!: string;

  maxItems?: number;
}

export class HumanApprovalConfig {
  promptTemplate!: string;

  timeoutSeconds?: number;
}

export class RetryPolicy {
  maxRetries!: number;

  delayMs?: number;
}

export class DynamicReasoningConfig {
  enabled!: boolean;
}

export class FlowNode {
  id!: string;

  kind!: string;

  label?: string;

  description?: string;

  taskTemplateId?: string;

  promptTemplateId?: string;

  outputFormatId?: string;

  input?: FlowNodeInput;

  output?: FlowNodeOutput;

  routerConfig?: RouterConfig;

  iteratorConfig?: IteratorConfig;

  humanApprovalConfig?: HumanApprovalConfig;

  retryPolicy?: RetryPolicy;

  hitlPolicy?: HitlPolicy;

  modelId?: string;

  metadata?: Record<string, unknown>;

  dynamicReasoning?: DynamicReasoningConfig;
}

export class Flow {
  ownerId!: string;

  assistantOperationId?: string | null;

  generationProvenance?: {
    source: 'conversation_handoff'; handoffVersion: 1; sourceConversationId: string;
    sourceTargetMessageId: string; displayedAnswerVersion: string; canonicalPathFingerprint: string;
    contextFingerprint: string; assistantRequestId: string; acceptedBy: string; acceptedAt: Date;
    confirmedWorkspaceIds: string[];
  };

  schemaVersion!: number;

  definitionRevision!: number;

  name!: string;

  description?: string;

  triggerConfig?: FlowTriggerConfig;

  settings!: FlowSettings;

  hitlPolicy!: HitlPolicy;

  hitlBlockers!: HitlBlockerRule[];

  nodes!: FlowNode[];

  controlEdges!: ControlEdge[];

  dataBindings!: DataBinding[];

  workspaces!: string[];

  designSettings?: Record<string, unknown>;

  isFavorite?: boolean;

  reflectionEnabled?: boolean;

  advisorScoringMode?: AdvisorScoringMode;

  advisorAutopilotEnabled?: boolean;

  advisorAutopilotTargetScore?: number;

  advisorAutopilotMaxTurns?: number;
}

