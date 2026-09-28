export type PlatformCopilotSurface =
  | 'playbook.list'
  | 'playbook.editor'
  | 'playbook.editor.assistant'
  | 'playbook.validation'
  | 'playbook.execution.details'
  | 'playbook.execution.task'
  | 'semanticModel.editor'
  | 'semanticModel.sources'
  | 'playbook.sources';

export type PlatformCopilotUiTarget = {
  surface: PlatformCopilotSurface;
  params: {
    playbookId?: string;
    executionId?: string;
    taskId?: string;
    operationId?: string;
    modelId?: string;
    /** Shown on the button ("Open Billing & Contract Management"), never an id. */
    modelName?: string;
    /** The waiting Yellowmind questions whose sources the person chooses in the conversation. */
    continuationId?: string;
    playbookName?: string;
  };
  effects?: Array<
    | { type: 'highlightTask'; taskId: string }
    | { type: 'focusExecutionStatus' }
  >;
};

export type PlatformCopilotPageContext = {
  route: string;
  module: 'playbooks' | 'executions' | 'other';
  surface: string;
  entity?: { type: 'playbook' | 'execution' | 'task'; id: string };
  selection?: { type: 'playbook' | 'execution' | 'task'; id: string };
  availableActions: string[];
  hasUnsavedChanges: boolean;
  locale: string;
  contextVersion: 1;
};
