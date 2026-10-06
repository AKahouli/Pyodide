export interface FlowNodeAdvisorSuggestion {
  id: string;
  type: 'task_title' | 'task_description' | 'agent_selection' | 'datasource_connection'
    | 'input_contract' | 'output_contract' | 'general';
  title: string;
  summary: string;
  rationale: string;
  confidence: number;
  patch?: {
    taskTitle?: string;
    taskDescription?: string;
    assignedAgentId?: string;
    inputPorts?: { id: string; name: string; artifactKind: string; description?: string }[];
    outputPorts?: { id: string; name: string; artifactKind: string; description?: string }[];
  };
  warnings?: string[];
}

export interface FlowNodeAdvisorResponse {
  flowId: string;
  nodeId: string;
  suggestions: FlowNodeAdvisorSuggestion[];
}

export interface FlowNodeAdvisorRequest {
  title?: string;
  description?: string;
  intent?: string;
  suggestionTypes?: string[];
  includeGraphContext?: boolean;
}

export interface FlowExecutionAdvisorConfig {
  enabled: boolean;
  targetScore: number;
  maxTurns: number;
}

export type FlowExecutionAdvisorStatus =
  'idle' | 'running' | 'judging' | 'optimizing' | 'rerunning' | 'completed' | 'stopped' | 'failed';

export interface FlowExecutionAdvisorTurnEntry {
  turn: number;
  score: number | null;
  recommendation: string | null;
  safeAutoFixType: string | null;
  actionType: 'evaluate' | 'optimize_step' | 'stop';
  stopReason?: string | null;
}

export interface FlowAdvisorSuggestionResponse {
  suggestions: {
    id: string;
    kind: 'upstream' | 'downstream' | 'validation' | 'approval' | 'trigger' | 'action' | 'split';
    title: string;
    description: string;
    reason: string;
    confidence: number;
    position: 'before' | 'after' | 'parallel';
    connectsFromTaskId: string | null;
    connectsToTaskId: string | null;
  }[];
  model: string;
  settings: any;
}
