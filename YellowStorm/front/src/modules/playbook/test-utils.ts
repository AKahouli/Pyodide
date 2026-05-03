import type {
  Playbook,
  PlaybookTask,
  PlaybookEdge,
  PlaybookExecution,
  PlaybookExecutionSummary,
} from './types';

const defaultDesignSettings = {
  inferenceModelId: null,
  nodeSuggestionsMode: 'inherit' as const,
  approvalSuggestionMode: 'inherit' as const,
};

const defaultEffectiveDesignSettings = {
  inferenceModelId: null,
  resolvedInferenceModelId: null,
  nodeSuggestionsMode: 'manual' as const,
  approvalSuggestionMode: 'auto' as const,
};

export function makeTask(overrides: Partial<PlaybookTask> = {}): PlaybookTask {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'Task description',
    assignedAgentId: null,
    executionOrder: 1,
    positionX: 10,
    positionY: 20,
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    clarificationPrompt: '',
    maxClarifications: 0,
    inputKeys: [],
    outputKey: 'result',
    notifyOnComplete: false,
    notifyEmails: [],
    inputFiles: [],
    ...overrides,
  };
}

export function makeEdge(overrides: Partial<PlaybookEdge> = {}): PlaybookEdge {
  return {
    id: 'edge-1',
    sourceId: 'task-1',
    targetId: 'task-2',
    ...overrides,
  };
}

export function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'playbook-1',
    name: 'Playbook',
    description: 'Description',
    designSettings: defaultDesignSettings,
    effectiveDesignSettings: defaultEffectiveDesignSettings,
    tasks: [makeTask(), makeTask({ id: 'task-2', executionOrder: 2, positionX: 200 })],
    edges: [makeEdge()],
    workspaces: [],
    createdBy: 'user-1',
    isFavorite: false,
    isActive: true,
    executionSchedule: null,
    reflectionEnabled: true,
    triggers: [
      { type: 'manual', enabled: true },
      { type: 'schedule', enabled: false, schedule: null },
      {
        type: 'mail',
        enabled: false,
        available: false,
        config: {
          enabled: false,
          mailboxAppKey: null,
          notificationUrl: null,
          autoRenewUntil: null,
          attachmentImportEnabled: false,
          allowedAttachmentExtensions: [],
          filters: {
            from: [],
            subjectContains: [],
            bodyContains: [],
            hasAttachments: null,
          },
          runtimeEnabled: false,
          subscriptionId: null,
          subscriptionClientState: null,
          subscriptionExpiresAt: null,
          runtimePayloadSchema: null,
        },
      },
    ],
    automatedTriggerType: null,
    advisorAutopilotEnabled: false,
    advisorAutopilotTargetScore: null,
    advisorAutopilotMaxTurns: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeExecution(overrides: Partial<PlaybookExecution> = {}): PlaybookExecution {
  return {
    id: 'exec-1',
    playbookId: 'playbook-1',
    executedBy: 'user-1',
    executionNumber: 1,
    currentAttemptNumber: 1,
    status: 'running',
    executionTrigger: 'manual',
    taskResults: [
      {
        taskId: 'task-1',
        nodeTitle: 'Task 1',
        agentName: 'Agent 1',
        order: 1,
        status: 'running',
        output: null,
        error: null,
        durationMs: null,
        startedAt: '2025-01-01T00:00:00.000Z',
        completedAt: null,
      },
    ],
    threadId: null,
    interruptPayload: null,
    waitingForHumanInput: false,
    currentInterruptId: null,
    currentInterruptTaskId: null,
    hitlHistory: [],
    error: null,
    durationMs: null,
    startedAt: '2025-01-01T00:00:00.000Z',
    completedAt: null,
    singleStepTaskId: null,
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeExecutionSummary(
  overrides: Partial<PlaybookExecutionSummary> = {},
): PlaybookExecutionSummary {
  return {
    id: 'exec-1',
    playbookId: 'playbook-1',
    executedBy: 'user-1',
    executionNumber: 1,
    currentAttemptNumber: 1,
    status: 'running',
    executionTrigger: 'manual',
    error: null,
    durationMs: null,
    startedAt: '2025-01-01T00:00:00.000Z',
    completedAt: null,
    singleStepTaskId: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}
