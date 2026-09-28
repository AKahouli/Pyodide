export type MascotExecutionStatus = 'running' | 'failed' | 'completed' | 'waiting' | 'cancelled';

export type PlaybookUiTarget = {
  surface:
    | 'playbook.list'
    | 'playbook.editor'
    | 'playbook.validation'
    | 'playbook.execution.details'
    | 'playbook.execution.task';
  params: {
    playbookId?: string;
    executionId?: string;
    taskId?: string;
    /** Shown on the button ("Open CV screening"), never an id. */
    playbookName?: string;
  };
  effects?: Array<
    | { type: 'highlightTask'; taskId: string }
    | { type: 'focusExecutionStatus' }
  >;
};

export type ExecutionDiagnosticCategory =
  | 'missing_input'
  | 'invalid_binding'
  | 'tool_error'
  | 'model_error'
  | 'timeout'
  | 'permission'
  | 'human_input_required'
  | 'unknown';

export interface ExecutionDiagnostics {
  executionId: string;
  playbookId: string;
  status: MascotExecutionStatus;
  summary: string;
  failedTask?: {
    taskId: string;
    taskName: string;
    iteration?: number;
  };
  cause?: {
    code: string;
    category: ExecutionDiagnosticCategory;
    message: string;
    retryable: boolean;
  };
  missingInputs?: Array<{
    name: string;
    expectedType?: string;
    sourceTaskId?: string;
  }>;
  recommendedNextActions: Array<{
    type: 'open_execution' | 'open_task' | 'wait_for_human' | 'contact_admin';
    label: string;
  }>;
  uiTarget: PlaybookUiTarget;
}
