export type SuggestionMode = 'auto' | 'manual';

export interface PlaybookIntentNormalizationLimits {
  maxWorkflowPlanChanges: number;
  maxInputPorts: number;
  maxOutputPorts: number;
  maxIteratorBodySteps: number;
  maxIteratorBodyEdges: number;
}

export interface DynamicReasoningAdminSettings {
  plannerAgentId: string | null;
  maxWorkNodes: number;
  maxParallelism: number;
  maxDepth: number;
  maxRepairAttempts: number;
}

export interface PlaybookExecutionAdminSettings {
  availableCapacity: number;
  maxConcurrentPerUser: number;
  maxConcurrentPerFlow: number;
  maxConcurrentPerProvider: number;
  maxConcurrentPerModel: number;
  executionQueueMaxDepth: number;
  maxParallelismPerExecution: number;
  recursionLimitDefault: number;
  recursionLimitMax: number;
  maxHitlRounds: number;
  pythonWorkerPoolSize: number;
  pythonWorkerMaxInflight: number;
  maxToolIterations: number;
  graphCacheEnabled: boolean;
  graphCacheMaxEntries: number;
  graphCacheTtlSeconds: number;
  dynamicReasoning: DynamicReasoningAdminSettings;
}

export interface AdminPlaybookSettings {
  playbookSuggestorAgentId: string | null;
  inferenceModelId: string | null;
  advisorEvaluationModelId: string | null;
  replayEvaluationModelId: string | null;
  nodeSuggestionsMode: SuggestionMode;
  approvalSuggestionMode: SuggestionMode;
  intentNormalizationLimits: PlaybookIntentNormalizationLimits;
  replayEligibilityConfidenceThreshold: number;
  useDeterministicBlueprintBuilder: boolean;
  playbookExecution: PlaybookExecutionAdminSettings;
}

export const DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS: PlaybookIntentNormalizationLimits = {
  maxWorkflowPlanChanges: 500,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 50,
};

export const DEFAULT_PLAYBOOK_EXECUTION_SETTINGS: PlaybookExecutionAdminSettings = {
  availableCapacity: 50,
  maxConcurrentPerUser: 10,
  maxConcurrentPerFlow: 5,
  maxConcurrentPerProvider: 25,
  maxConcurrentPerModel: 10,
  executionQueueMaxDepth: 50,
  maxParallelismPerExecution: 5,
  recursionLimitDefault: 25,
  recursionLimitMax: 50,
  maxHitlRounds: 5,
  pythonWorkerPoolSize: 8,
  pythonWorkerMaxInflight: 4,
  maxToolIterations: 40,
  graphCacheEnabled: false,
  graphCacheMaxEntries: 128,
  graphCacheTtlSeconds: 900,
  dynamicReasoning: {
    plannerAgentId: null,
    maxWorkNodes: 6,
    maxParallelism: 3,
    maxDepth: 1,
    maxRepairAttempts: 1,
  },
};

export const DEFAULT_ADMIN_PLAYBOOK_SETTINGS: AdminPlaybookSettings = {
  playbookSuggestorAgentId: null,
  inferenceModelId: null,
  advisorEvaluationModelId: null,
  replayEvaluationModelId: null,
  nodeSuggestionsMode: 'manual',
  approvalSuggestionMode: 'auto',
  intentNormalizationLimits: DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS,
  replayEligibilityConfidenceThreshold: 70,
  useDeterministicBlueprintBuilder: true,
  playbookExecution: DEFAULT_PLAYBOOK_EXECUTION_SETTINGS,
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

export function normalizePlaybookExecutionSettings(
  value?: Partial<PlaybookExecutionAdminSettings> | null,
): PlaybookExecutionAdminSettings {
  const defaults = DEFAULT_PLAYBOOK_EXECUTION_SETTINGS;
  const availableCapacity = boundedInteger(value?.availableCapacity, defaults.availableCapacity, 1, 500);
  const maxParallelismPerExecution = boundedInteger(
    value?.maxParallelismPerExecution,
    defaults.maxParallelismPerExecution,
    1,
    100,
  );
  const recursionLimitMax = boundedInteger(value?.recursionLimitMax, defaults.recursionLimitMax, 1, 500);
  const recursionLimitDefault = Math.min(
    recursionLimitMax,
    boundedInteger(value?.recursionLimitDefault, defaults.recursionLimitDefault, 1, 500),
  );
  const maxWorkNodes = boundedInteger(value?.dynamicReasoning?.maxWorkNodes, defaults.dynamicReasoning.maxWorkNodes, 1, 32);

  return {
    availableCapacity,
    maxConcurrentPerUser: Math.min(availableCapacity, boundedInteger(value?.maxConcurrentPerUser, defaults.maxConcurrentPerUser, 1, 500)),
    maxConcurrentPerFlow: Math.min(availableCapacity, boundedInteger(value?.maxConcurrentPerFlow, defaults.maxConcurrentPerFlow, 1, 500)),
    maxConcurrentPerProvider: Math.min(availableCapacity, boundedInteger(value?.maxConcurrentPerProvider, defaults.maxConcurrentPerProvider, 1, 500)),
    maxConcurrentPerModel: Math.min(availableCapacity, boundedInteger(value?.maxConcurrentPerModel, defaults.maxConcurrentPerModel, 1, 500)),
    executionQueueMaxDepth: boundedInteger(value?.executionQueueMaxDepth, defaults.executionQueueMaxDepth, 0, 5000),
    maxParallelismPerExecution,
    recursionLimitDefault,
    recursionLimitMax,
    maxHitlRounds: boundedInteger(value?.maxHitlRounds, defaults.maxHitlRounds, 0, 100),
    pythonWorkerPoolSize: boundedInteger(value?.pythonWorkerPoolSize, defaults.pythonWorkerPoolSize, 1, 100),
    pythonWorkerMaxInflight: boundedInteger(value?.pythonWorkerMaxInflight, defaults.pythonWorkerMaxInflight, 1, 20),
    maxToolIterations: boundedInteger(value?.maxToolIterations, defaults.maxToolIterations, 1, 500),
    graphCacheEnabled: typeof value?.graphCacheEnabled === 'boolean' ? value.graphCacheEnabled : defaults.graphCacheEnabled,
    graphCacheMaxEntries: boundedInteger(value?.graphCacheMaxEntries, defaults.graphCacheMaxEntries, 1, 10000),
    graphCacheTtlSeconds: boundedInteger(value?.graphCacheTtlSeconds, defaults.graphCacheTtlSeconds, 1, 86400),
    dynamicReasoning: {
      plannerAgentId: typeof value?.dynamicReasoning?.plannerAgentId === 'string'
        ? value.dynamicReasoning.plannerAgentId.trim() || null
        : null,
      maxWorkNodes,
      maxParallelism: Math.min(
        maxWorkNodes,
        maxParallelismPerExecution,
        boundedInteger(value?.dynamicReasoning?.maxParallelism, defaults.dynamicReasoning.maxParallelism, 1, 32),
      ),
      maxDepth: 1,
      maxRepairAttempts: boundedInteger(value?.dynamicReasoning?.maxRepairAttempts, defaults.dynamicReasoning.maxRepairAttempts, 0, 3),
    },
  };
}
