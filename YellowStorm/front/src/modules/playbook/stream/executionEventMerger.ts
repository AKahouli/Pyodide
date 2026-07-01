import { normalizeTaskArtifacts } from '@/modules/playbook/api';
import type {
  PlaybookAdvisorAutopilotUpdatedEvent,
  PlaybookExecution,
  PlaybookExecutionCompleteEvent,
  PlaybookExecutionStartEvent,
  PlaybookInterruptEvent,
  PlaybookIteratorChildStepCompleteEvent,
  PlaybookIteratorChildStepStartEvent,
  PlaybookIteratorChildStepUpdateEvent,
  PlaybookJudgeSummaryUpdatedEvent,
  PlaybookStepCompleteEvent,
  PlaybookStepEvaluationUpdatedEvent,
  PlaybookStepJudgeStartedEvent,
  PlaybookStepJudgeUpdatedEvent,
  PlaybookStepStartEvent,
  PlaybookStepUpdateEvent,
  TaskResult,
} from '@/modules/playbook/types';

type TaskPatch = Partial<TaskResult> & Pick<TaskResult, 'taskId'>;
type IteratorChildStatus = 'running' | 'completed' | 'failed' | 'skipped';

function now() {
  return new Date().toISOString();
}

function emptyTask(taskId: string, order: number): TaskResult {
  return {
    taskId,
    nodeTitle: '',
    agentName: '',
    order,
    status: 'pending',
    output: null,
    error: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    semanticMatch: null,
    judgeStatus: 'idle',
    judgeResult: null,
    judgeError: null,
    judgeHistory: [],
    evaluationHistory: [],
    stepExecutions: [],
    isStale: false,
    staleReason: null,
    invalidatedByTaskId: null,
  };
}

function mergeTask(previous: PlaybookExecution, patch: TaskPatch): TaskResult[] {
  const existing = previous.taskResults;
  const index = existing.findIndex((task) => task.taskId === patch.taskId);
  if (index === -1) {
    return [...existing, { ...emptyTask(patch.taskId, existing.length), ...patch }];
  }
  return existing.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task);
}

function mergeIteratorChild(
  previous: PlaybookExecution,
  data: {
    parentIteratorId: string;
    iterationIndex: number;
    taskId: string;
    taskTitle?: string;
    status: IteratorChildStatus;
    output?: string | null;
    error?: string | null;
    components?: TaskResult['components'];
    toolTrace?: TaskResult['toolTrace'];
    reasoningChain?: TaskResult['reasoningChain'];
    llmPromptTrace?: TaskResult['llmPromptTrace'];
    artifacts?: TaskResult['artifacts'];
  },
): PlaybookExecution {
  const taskResults = previous.taskResults.map((task) => {
    if (task.taskId !== data.parentIteratorId) return task;
    const iterations = [...(task.iteratorIterations || [])];
    const iterationIndex = iterations.findIndex((iteration) => iteration.index === data.iterationIndex);
    const iteration = iterationIndex >= 0
      ? { ...iterations[iterationIndex] }
      : { index: data.iterationIndex, status: 'running' as const, output: null, error: null, childResults: [] };
    const children = [...iteration.childResults];
    const childIndex = children.findIndex((child) => child.taskId === data.taskId);
    const existingChild = childIndex >= 0 ? children[childIndex] : null;
    const child = {
      taskId: data.taskId,
      taskTitle: data.taskTitle || existingChild?.taskTitle || '',
      status: data.status,
      output: data.output ?? existingChild?.output ?? null,
      error: data.error ?? existingChild?.error ?? null,
      components: data.components ?? existingChild?.components,
      toolTrace: data.toolTrace ?? existingChild?.toolTrace,
      reasoningChain: data.reasoningChain ?? existingChild?.reasoningChain,
      llmPromptTrace: data.llmPromptTrace ?? existingChild?.llmPromptTrace,
      artifacts: data.artifacts ?? existingChild?.artifacts,
    };
    if (childIndex >= 0) children[childIndex] = child;
    else children.push(child);
    iteration.childResults = children;
    iteration.status = children.some((item) => item.status === 'running' || item.status === 'interrupted')
      ? 'running'
      : children.some((item) => item.status === 'failed') ? 'failed' : 'completed';
    if (iterationIndex >= 0) iterations[iterationIndex] = iteration;
    else iterations.push(iteration);
    return { ...task, iteratorIterations: iterations.sort((left, right) => left.index - right.index) };
  });
  return { ...previous, taskResults, updatedAt: now() };
}

export function mergeExecutionStarted(previous: PlaybookExecution | undefined, data: PlaybookExecutionStartEvent): PlaybookExecution {
  const taskResults = data.taskResults && data.taskResults.length > 0
    ? data.taskResults
    : previous?.taskResults ?? [];

  return {
    id: data.executionId,
    playbookId: data.playbookId,
    executedBy: previous?.executedBy || '',
    executionNumber: data.executionNumber,
    status: data.status as PlaybookExecution['status'],
    executionMode: data.executionMode || previous?.executionMode || 'live',
    stepExecutionModes: data.stepExecutionModes ?? previous?.stepExecutionModes ?? {},
    executionTrigger: previous?.executionTrigger || 'manual',
    reflectionEnabled: data.reflectionEnabled !== false,
    advisorScoringMode: data.advisorScoringMode ?? previous?.advisorScoringMode ?? 'llm',
    advisorAutopilotEnabled: data.advisorAutopilotEnabled === true,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore ?? 90,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns ?? 4,
    advisorAutopilotStatus: data.advisorAutopilotStatus || 'idle',
    advisorAutopilotTaskId: data.advisorAutopilotTaskId ?? null,
    advisorAutopilotAttemptCount: data.advisorAutopilotAttemptCount ?? 0,
    advisorAutopilotLastError: data.advisorAutopilotLastError ?? null,
    judgeSummaryStatus: previous?.judgeSummaryStatus ?? 'idle',
    judgeSummary: previous?.judgeSummary ?? null,
    replaySourceByTask: data.replaySourceByTask || null,
    replayPlanningByTask: data.replayPlanningByTask || null,
    taskResults,
    threadId: previous?.threadId ?? null,
    interruptPayload: null,
    pendingInterrupts: [],
    waitingForHumanInput: false,
    currentInterruptId: null,
    currentInterruptTaskId: null,
    hitlHistory: previous?.hitlHistory ?? [],
    error: null,
    durationMs: null,
    startedAt: previous?.startedAt || now(),
    completedAt: null,
    singleStepTaskId: data.singleStepTaskId ?? previous?.singleStepTaskId ?? null,
    playbookSnapshot: previous?.playbookSnapshot ?? null,
    totalInputTokens: previous?.totalInputTokens ?? 0,
    totalOutputTokens: previous?.totalOutputTokens ?? 0,
    totalTokens: previous?.totalTokens ?? 0,
    createdAt: previous?.createdAt || now(),
    updatedAt: now(),
  };
}

export function mergeExecutionQueued(previous: PlaybookExecution | undefined, data: PlaybookExecutionStartEvent): PlaybookExecution {
  return mergeExecutionStarted(previous, { ...data, status: 'queued' });
}

export function mergeStepStarted(previous: PlaybookExecution | undefined, data: PlaybookStepStartEvent): PlaybookExecution | undefined {
  if (!previous) return undefined;
  return {
    ...previous,
    taskResults: mergeTask(previous, {
      taskId: data.taskId,
      status: 'running',
      output: null,
      error: null,
      durationMs: null,
      startedAt: now(),
      completedAt: null,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
    }),
    updatedAt: now(),
  };
}

export function mergeStepUpdated(previous: PlaybookExecution | undefined, data: PlaybookStepUpdateEvent): PlaybookExecution | undefined {
  if (!previous) return undefined;
  const existing = previous.taskResults.find((task) => task.taskId === data.taskId);
  return {
    ...previous,
    taskResults: mergeTask(previous, {
      taskId: data.taskId,
      status: existing?.status === 'pending' || existing?.status === 'running' || !existing
        ? 'running'
        : existing.status,
      output: data.output ?? existing?.output ?? null,
      components: data.components,
      toolTrace: data.toolTrace,
      llmPromptTrace: data.llmPromptTrace,
      inputTokens: data.inputTokens ?? null,
      outputTokens: data.outputTokens ?? null,
      totalTokens: data.totalTokens ?? null,
      modelName: data.modelName ?? null,
      traceMetadata: data.traceMetadata ?? null,
      artifacts: data.artifacts ? normalizeTaskArtifacts(data.artifacts) : undefined,
      startedAt: now(),
      completedAt: existing?.status === 'pending' || existing?.status === 'running' || !existing
        ? null
        : existing.completedAt,
      error: existing?.status === 'pending' || existing?.status === 'running' || !existing
        ? null
        : existing.error,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
    }),
    updatedAt: now(),
  };
}

export function mergeStepCompleted(previous: PlaybookExecution | undefined, data: PlaybookStepCompleteEvent): PlaybookExecution | undefined {
  if (!previous) return undefined;
  return {
    ...previous,
    taskResults: mergeTask(previous, {
      taskId: data.taskId,
      iteration: data.iteration,
      status: data.status as TaskResult['status'],
      output: data.output ?? null,
      error: data.error ?? null,
      durationMs: data.durationMs ?? null,
      completedAt: now(),
      components: data.components,
      toolTrace: data.toolTrace ?? [],
      reasoningChain: data.reasoningChain ?? [],
      llmPromptTrace: data.llmPromptTrace ?? [],
      inputTokens: data.inputTokens ?? null,
      outputTokens: data.outputTokens ?? null,
      totalTokens: data.totalTokens ?? null,
      modelName: data.modelName ?? null,
      semanticMatch: data.semanticMatch ?? null,
      traceMetadata: data.traceMetadata ?? null,
      iteratorIterations: data.iteratorIterations,
      artifacts: data.artifacts ? normalizeTaskArtifacts(data.artifacts) : undefined,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
    }),
    updatedAt: now(),
  };
}
