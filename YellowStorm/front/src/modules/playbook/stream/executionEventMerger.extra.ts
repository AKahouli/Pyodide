import type {
  PlaybookAdvisorAutopilotUpdatedEvent,
  PlaybookExecution,
  PlaybookExecutionCompleteEvent,
  PlaybookInterruptEvent,
  PlaybookIteratorChildStepCompleteEvent,
  PlaybookIteratorChildStepStartEvent,
  PlaybookIteratorChildStepUpdateEvent,
  PlaybookJudgeSummaryUpdatedEvent,
  PlaybookStepEvaluationUpdatedEvent,
  PlaybookStepJudgeStartedEvent,
  PlaybookStepJudgeUpdatedEvent,
  TaskResult,
} from '@/modules/playbook/types';

function now() {
  return new Date().toISOString();
}

export function mergeIteratorChildStarted(previous: PlaybookExecution | undefined, data: PlaybookIteratorChildStepStartEvent) {
  if (!previous) return undefined;
  return mergeIteratorChild(previous, { ...data, status: 'running' });
}

export function mergeIteratorChildUpdated(previous: PlaybookExecution | undefined, data: PlaybookIteratorChildStepUpdateEvent) {
  if (!previous) return undefined;
  return mergeIteratorChild(previous, { ...data, status: 'running', output: data.output ?? null });
}

export function mergeIteratorChildCompleted(previous: PlaybookExecution | undefined, data: PlaybookIteratorChildStepCompleteEvent) {
  if (!previous) return undefined;
  return mergeIteratorChild(previous, { ...data, status: data.status === 'failed' ? 'failed' : data.status === 'skipped' ? 'skipped' : 'completed' });
}

export function mergeStepJudgeStarted(previous: PlaybookExecution | undefined, data: PlaybookStepJudgeStartedEvent) {
  if (!previous) return undefined;
  return updateTask(previous, data.taskId, {
    judgeStatus: data.judgeStatus,
    judgeScoringMode: data.advisorScoringMode ?? null,
    judgeError: null,
    judgeResult: null,
  });
}

export function mergeStepJudgeUpdated(previous: PlaybookExecution | undefined, data: PlaybookStepJudgeUpdatedEvent) {
  if (!previous) return undefined;
  return updateTask(previous, data.taskId, (task) => ({
    judgeStatus: data.judgeStatus,
    judgeScoringMode: data.advisorScoringMode ?? task.judgeScoringMode ?? null,
    judgeResult: data.judgeResult ?? null,
    judgeError: data.judgeError ?? null,
    judgeHistory: data.judgeHistoryEntry ? [...(task.judgeHistory || []), data.judgeHistoryEntry] : task.judgeHistory || [],
  }));
}

export function mergeStepEvaluationUpdated(previous: PlaybookExecution | undefined, data: PlaybookStepEvaluationUpdatedEvent) {
  if (!previous) return undefined;
  return updateTask(previous, data.taskId, (task) => ({
    semanticMatch: data.semanticMatch ?? null,
    evaluationHistory: data.evaluationEntry
      ? [...(task.evaluationHistory || []).filter((item) => item.id !== data.evaluationEntry?.id), data.evaluationEntry]
      : task.evaluationHistory || [],
  }));
}

export function mergeJudgeSummaryUpdated(previous: PlaybookExecution | undefined, data: PlaybookJudgeSummaryUpdatedEvent) {
  if (!previous) return undefined;
  return { ...previous, judgeSummaryStatus: 'evaluated' as const, judgeSummary: data.judgeSummary, updatedAt: now() };
}

export function mergeAdvisorAutopilotUpdated(previous: PlaybookExecution | undefined, data: PlaybookAdvisorAutopilotUpdatedEvent) {
  if (!previous) return undefined;
  const taskResults = data.taskId
    ? previous.taskResults.map((task) => task.taskId === data.taskId ? {
        ...task,
        advisorTurnCount: data.advisorTurnCount ?? task.advisorTurnCount ?? 0,
        lastAdvisorAction: data.lastAdvisorAction ?? task.lastAdvisorAction ?? null,
        lastAdvisorScoreDelta: data.lastAdvisorScoreDelta ?? task.lastAdvisorScoreDelta ?? null,
        advisorStopReason: data.advisorStopReason ?? task.advisorStopReason ?? null,
        advisorTurnHistory: data.advisorTurnHistoryEntry ? [...(task.advisorTurnHistory || []), data.advisorTurnHistoryEntry] : task.advisorTurnHistory || [],
        advisorOptimizationHistory: data.advisorOptimizationHistoryEntry ? [...(task.advisorOptimizationHistory || []), data.advisorOptimizationHistoryEntry] : task.advisorOptimizationHistory || [],
      } : task)
    : previous.taskResults;
  return {
    ...previous,
    taskResults,
    advisorAutopilotStatus: data.advisorAutopilotStatus ?? previous.advisorAutopilotStatus,
    advisorAutopilotAttemptCount: data.advisorAutopilotAttemptCount ?? previous.advisorAutopilotAttemptCount,
    advisorAutopilotTaskId: data.advisorAutopilotTaskId ?? previous.advisorAutopilotTaskId,
    advisorAutopilotLastError: data.advisorAutopilotLastError ?? previous.advisorAutopilotLastError,
    updatedAt: now(),
  };
}

export function mergeExecutionCompleted(previous: PlaybookExecution | undefined, data: PlaybookExecutionCompleteEvent) {
  if (!previous) return undefined;
  const status = (data.status || 'failed') as PlaybookExecution['status'];
  const skippedTaskIds = new Set(data.skippedTaskIds || []);
  return {
    ...previous,
    status,
    durationMs: data.durationMs ?? null,
    error: data.error ?? null,
    completedAt: now(),
    taskResults: previous.taskResults.map((task) => {
      if (skippedTaskIds.has(task.taskId)) return { ...task, status: 'skipped' as const };
      if (task.status !== 'running') return task;
      return { ...task, status: status as TaskResult['status'], completedAt: now(), durationMs: task.durationMs ?? data.durationMs ?? null };
    }),
    totalInputTokens: data.totalInputTokens ?? previous.totalInputTokens,
    totalOutputTokens: data.totalOutputTokens ?? previous.totalOutputTokens,
    totalTokens: data.totalTokens ?? previous.totalTokens,
    updatedAt: now(),
  };
}

export function mergeInterrupt(previous: PlaybookExecution | undefined, data: PlaybookInterruptEvent) {
  if (!previous) return undefined;
  return {
    ...previous,
    status: 'interrupted' as const,
    threadId: data.threadId || previous.threadId,
    interruptPayload: {
      ...data,
      taskTitle: data.taskDescription || '',
    },
    waitingForHumanInput: true,
    currentInterruptId: data.interruptId ?? previous.currentInterruptId ?? null,
    currentInterruptTaskId: data.taskId,
    updatedAt: now(),
  };
}

function updateTask(
  previous: PlaybookExecution,
  taskId: string,
  patch: Partial<TaskResult> | ((task: TaskResult) => Partial<TaskResult>),
) {
  return {
    ...previous,
    taskResults: previous.taskResults.map((task) => task.taskId === taskId
      ? { ...task, ...(typeof patch === 'function' ? patch(task) : patch) }
      : task),
    updatedAt: now(),
  };
}

function mergeIteratorChild(
  previous: PlaybookExecution,
  data: {
    parentIteratorId: string;
    iterationIndex: number;
    taskId: string;
    taskTitle?: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    output?: string | null;
    error?: string | null;
    components?: TaskResult['components'];
    toolTrace?: TaskResult['toolTrace'];
    reasoningChain?: TaskResult['reasoningChain'];
    llmPromptTrace?: TaskResult['llmPromptTrace'];
    artifacts?: TaskResult['artifacts'];
  },
) {
  const parent = previous.taskResults.find((task) => task.taskId === data.parentIteratorId);
  if (!parent) return previous;
  return {
    ...previous,
    taskResults: previous.taskResults.map((task) => task.taskId !== data.parentIteratorId ? task : mergeParentTask(task, data)),
    updatedAt: now(),
  };
}

function mergeParentTask(task: TaskResult, data: Parameters<typeof mergeIteratorChild>[1]) {
  const iterations = [...(task.iteratorIterations || [])];
  const iterationIndex = iterations.findIndex((iteration) => iteration.index === data.iterationIndex);
  const iteration = iterationIndex >= 0
    ? { ...iterations[iterationIndex] }
    : { index: data.iterationIndex, status: 'running' as const, output: null, error: null, childResults: [] };
  const children = [...iteration.childResults];
  const childIndex = children.findIndex((child) => child.taskId === data.taskId);
  const previousChild = childIndex >= 0 ? children[childIndex] : null;
  const child = {
    taskId: data.taskId,
    taskTitle: data.taskTitle || previousChild?.taskTitle || '',
    status: data.status,
    output: data.output ?? previousChild?.output ?? null,
    error: data.error ?? previousChild?.error ?? null,
    components: data.components ?? previousChild?.components,
    toolTrace: data.toolTrace ?? previousChild?.toolTrace,
    reasoningChain: data.reasoningChain ?? previousChild?.reasoningChain,
    llmPromptTrace: data.llmPromptTrace ?? previousChild?.llmPromptTrace,
    artifacts: data.artifacts ?? previousChild?.artifacts,
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
}
