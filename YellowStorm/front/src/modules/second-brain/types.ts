export type SecondBrainSurface =
  | 'playbook.list'
  | 'playbook.editor'
  | 'playbook.validation'
  | 'playbook.execution.details'
  | 'playbook.execution.task';

export type SecondBrainUiTarget = {
  surface: SecondBrainSurface;
  params: {
    playbookId?: string;
    executionId?: string;
    taskId?: string;
  };
  effects?: Array<
    | { type: 'selectTab'; tab: string }
    | { type: 'highlightTask'; taskId: string }
    | { type: 'focusExecutionStatus' }
  >;
};

export type SecondBrainPageContext = {
  route: string;
  module: 'playbooks' | 'executions' | 'other';
  surface: string;
  entity?: { type: 'playbook' | 'execution' | 'task'; id: string };
  selection?: { type: 'playbook' | 'execution' | 'task'; id: string };
  availableActions: string[];
  hasUnsavedChanges: boolean;
  locale: string;
  contextVersion: number;
};

export type PendingSecondBrainAction = {
  confirmationId: string;
  toolName: string;
  summary: {
    playbookId?: string;
    playbookName?: string;
    definitionRevision?: number;
    validationStatus?: 'valid' | 'warning' | 'invalid';
    inputLabels?: string[];
  };
  expiresAt: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'executed';
};

export type SecondBrainToolResult = {
  name: string;
  status: 'completed' | 'failed';
  result: unknown;
};

export type SecondBrainTurnResponse = {
  conversationId: string;
  correlationId: string;
  answer: string;
  toolResults: SecondBrainToolResult[];
  pendingAction: PendingSecondBrainAction | null;
};
