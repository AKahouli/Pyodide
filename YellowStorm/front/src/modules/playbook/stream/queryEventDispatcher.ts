import type { QueryClient } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';
import { playbookFeatures } from '@/modules/playbook/features';
import { dispatchExecutionLifecycleStreamEvent } from '@/modules/playbook/machines/execution/executionLifecycleEvents';
import type { HitlBlockerRule, HitlMemory, HitlPolicy, Playbook, PlaybookExecution, PlaybookExecutionSummary } from '@/modules/playbook/types';
import type { PlaybookStreamEvent } from './eventTypes';
import {
  mergeExecutionQueued,
  mergeExecutionStarted,
  mergeStepStarted,
  mergeStepUpdated,
  mergeStepCompleted,
  mergeDynamicReasoningUpdate,
} from './executionEventMerger';
import {
  mergeAdvisorAutopilotUpdated,
  mergeExecutionCompleted,
  mergeHitlInterruptResolved,
  mergeHitlInterruptUpdated,
  mergeInterrupt,
  mergeIteratorChildCompleted,
  mergeIteratorChildStarted,
  mergeIteratorChildUpdated,
  mergeJudgeSummaryUpdated,
  mergeStepEvaluationUpdated,
  mergeStepJudgeStarted,
  mergeStepJudgeUpdated,
} from './executionEventMerger.extra';

type DispatchOptions = {
  queryClient?: QueryClient;
};

/** Routes SSE payloads into the TanStack cache without forcing a global Zustand snapshot update. */
export function dispatchPlaybookStreamEvent(event: PlaybookStreamEvent, options: DispatchOptions = {}) {
  const queryClient = options.queryClient ?? playbookQueryClient;

  if (playbookFeatures.xstateExecutionEnabled) {
    dispatchExecutionLifecycleStreamEvent(event);
  }

  switch (event.type) {
    case 'playbook_connected':
      if (Array.isArray(event.data.activeExecutions)) {
        setActiveExecutions(queryClient, event.data.activeExecutions as PlaybookExecution[]);
      }
      return;
    case 'playbook_execution_start':
      setExecution(queryClient, event.data.executionId, (previous) => (
        event.data.status === 'queued'
          ? mergeExecutionQueued(previous, event.data)
          : mergeExecutionStarted(previous, event.data)
      ));
      upsertActiveExecution(queryClient, queryClient.getQueryData(playbookKeys.execution(event.data.executionId)));
      return;
    case 'playbook_step_start':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepStarted(previous, event.data));
      return;
    case 'playbook_step_update':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepUpdated(previous, event.data));
      return;
    case 'playbook_step_complete':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepCompleted(previous, event.data));
      return;
    case 'playbook_dynamic_reasoning_update':
    case 'playbook_runtime_subgraph_created':
    case 'playbook_runtime_subgraph_completed':
    case 'playbook_runtime_subgraph_failed':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeDynamicReasoningUpdate(previous, event.data));
      return;
    case 'playbook_iterator_child_step_start':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeIteratorChildStarted(previous, event.data));
      return;
    case 'playbook_iterator_child_step_update':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeIteratorChildUpdated(previous, event.data));
      return;
    case 'playbook_iterator_child_step_complete':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeIteratorChildCompleted(previous, event.data));
      return;
    case 'playbook_step_judge_started':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepJudgeStarted(previous, event.data));
      return;
    case 'playbook_step_judge_updated':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepJudgeUpdated(previous, event.data));
      return;
    case 'playbook_step_evaluation_updated':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeStepEvaluationUpdated(previous, event.data));
      return;
    case 'playbook_judge_summary_updated':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeJudgeSummaryUpdated(previous, event.data));
      return;
    case 'playbook_advisor_autopilot_updated':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeAdvisorAutopilotUpdated(previous, event.data));
      return;
    case 'playbook_replay_format_guide_updated':
      updatePlaybookTask(queryClient, event.data.playbookId, event.data.taskId, {
        hasValidatedReplay: true,
        activeReplayId: event.data.replay.status === 'active' ? event.data.replay.id : undefined,
        activeReplayVersion: event.data.replay.status === 'active' ? event.data.replay.validationVersion : undefined,
        activeReplayIsStale: event.data.replay.isStale || false,
        activeReplayStaleReasons: event.data.replay.staleReasons || [],
        activeReplayPreserveOutputFormat: event.data.replay.preserveOutputFormat || false,
        activeReplayFormatGuideStatus: event.data.replay.formatGuideStatus || 'disabled',
        activeReplayFormatGuideError: event.data.replay.formatGuideError || null,
        isSavingReplayBaseline: false,
      });
      return;
    case 'playbook_output_format_template_updated':
      updatePlaybookTask(queryClient, event.data.playbookId, event.data.taskId, {
        hasOutputFormatTemplate: event.data.template.status === 'active',
        activeOutputFormatTemplateId: event.data.template.status === 'active' ? event.data.template.id : null,
        activeOutputFormatTemplateVersion: event.data.template.status === 'active' ? event.data.template.templateVersion : null,
        activeOutputFormatStatus: event.data.template.status === 'active' ? event.data.template.generationStatus : null,
        activeOutputFormatError: event.data.template.status === 'active' ? event.data.template.generationError || null : null,
      });
      return;
    case 'playbook_execution_complete':
    case 'playbook_execution_error':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeExecutionCompleted(previous, event.data));
      removeActiveExecution(queryClient, event.data.executionId);
      invalidateExecutionHistory(queryClient, event.data.executionId);
      return;
    case 'playbook_interrupt':
    case 'playbook_hitl_interrupt_created':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeInterrupt(previous, event.data));
      return;
    case 'playbook_hitl_interrupt_updated':
      updateHitlInterrupt(queryClient, event.data);
      return;
    case 'playbook_hitl_interrupt_resolved':
      updateExecution(queryClient, event.data.executionId, (previous) => mergeHitlInterruptResolved(previous, event.data));
      return;
    case 'playbook_hitl_policy_updated':
      invalidateHitlPolicy(queryClient, event.data);
      return;
    case 'playbook_hitl_blocker_disabled':
      patchDisabledHitlBlocker(queryClient, event.data);
      return;
    case 'playbook_hitl_memory_suggested':
    case 'playbook_hitl_memory_saved':
      invalidateHitlMemories(queryClient, event.data);
      return;
    case 'playbook_replay_hitl_summary_updated':
      invalidateReplayReports(queryClient, event.data);
      return;
  }
}

function updateHitlInterrupt(queryClient: QueryClient, data: Record<string, unknown>) {
  if (typeof data.executionId !== 'string') return;
  updateExecution(queryClient, data.executionId, (previous) => mergeHitlInterruptUpdated(previous, data));
}

function updateExecution(
  queryClient: QueryClient,
  executionId: string,
  merge: (previous: PlaybookExecution | undefined) => PlaybookExecution | undefined,
) {
  const updated = setExecution(queryClient, executionId, merge);
  upsertActiveExecution(queryClient, updated);
}

function setExecution(
  queryClient: QueryClient,
  executionId: string,
  merge: (previous: PlaybookExecution | undefined) => PlaybookExecution | undefined,
) {
  let updated: PlaybookExecution | undefined;
  queryClient.setQueryData<PlaybookExecution | undefined>(playbookKeys.execution(executionId), (previous) => {
    updated = merge(previous);
    return updated ?? previous;
  });
  return updated;
}

function setActiveExecutions(queryClient: QueryClient, executions: PlaybookExecution[]) {
  queryClient.setQueryData(playbookKeys.activeExecutions(), executions);
  for (const execution of executions) {
    queryClient.setQueryData(playbookKeys.execution(execution.id), execution);
  }
}

function upsertActiveExecution(queryClient: QueryClient, execution: PlaybookExecution | undefined) {
  if (!execution || !isActiveExecutionStatus(execution.status)) return;
  queryClient.setQueryData<PlaybookExecution[]>(playbookKeys.activeExecutions(), (previous = []) => [
    execution,
    ...previous.filter((item) => item.id !== execution.id),
  ]);
}

function removeActiveExecution(queryClient: QueryClient, executionId: string) {
  queryClient.setQueryData<PlaybookExecution[]>(playbookKeys.activeExecutions(), (previous = []) => (
    previous.filter((execution) => execution.id !== executionId)
  ));
}

function invalidateExecutionHistory(queryClient: QueryClient, executionId: string) {
  const execution = queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution(executionId));
  if (!execution?.playbookId) return;
  queryClient.setQueryData<PlaybookExecutionSummary[]>(playbookKeys.executions(execution.playbookId), (previous) => (
    previous?.map((summary) => summary.id === executionId ? { ...summary, status: execution.status } : summary)
  ));
  void queryClient.invalidateQueries({ queryKey: playbookKeys.executions(execution.playbookId) });
}

function updatePlaybookTask(
  queryClient: QueryClient,
  playbookId: string,
  taskId: string,
  patch: Record<string, unknown>,
) {
  for (const view of ['base', 'enriched'] as const) {
    queryClient.setQueryData<Playbook | undefined>(playbookKeys.detail(playbookId, view), (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        tasks: previous.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
      };
    });
  }
}

function getHitlFlowId(queryClient: QueryClient, data: Record<string, unknown>) {
  if (typeof data.flowId === 'string') return data.flowId;
  if (typeof data.playbookId === 'string') return data.playbookId;
  if (typeof data.executionId !== 'string') return undefined;
  return queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution(data.executionId))?.playbookId;
}

function invalidateHitlPolicy(queryClient: QueryClient, data: Record<string, unknown>) {
  const flowId = getHitlFlowId(queryClient, data);
  if (!flowId) return;

  const nodeId = typeof data.nodeId === 'string' ? data.nodeId : undefined;
  if (isHitlPolicy(data.policy)) {
    queryClient.setQueryData(playbookKeys.hitlPolicy(flowId, nodeId), data.policy);
  }
  void queryClient.invalidateQueries({ queryKey: playbookKeys.hitlPolicy(flowId, nodeId) });
}

function patchDisabledHitlBlocker(queryClient: QueryClient, data: Record<string, unknown>) {
  const flowId = getHitlFlowId(queryClient, data);
  if (!flowId) return;

  queryClient.setQueryData<HitlBlockerRule[]>(playbookKeys.hitlBlockers(flowId), (previous) => (
    previous?.map((blocker) => blocker.id === data.blockerId ? { ...blocker, enabled: false } : blocker)
  ));
  void queryClient.invalidateQueries({ queryKey: playbookKeys.hitlBlockers(flowId) });
}

function invalidateHitlMemories(queryClient: QueryClient, data: Record<string, unknown>) {
  const flowId = getHitlFlowId(queryClient, data);
  if (!flowId) return;

  const memory = data.memory;
  if (isHitlMemory(memory)) {
    queryClient.setQueryData<HitlMemory[]>(playbookKeys.hitlMemories(flowId), (previous = []) => [
      memory,
      ...previous.filter((item) => item.id !== memory.id),
    ]);
  }
  void queryClient.invalidateQueries({ queryKey: playbookKeys.hitlMemories(flowId) });
}

function invalidateReplayReports(queryClient: QueryClient, data: Record<string, unknown>) {
  const flowId = getHitlFlowId(queryClient, data);
  const taskId = typeof data.taskId === 'string' ? data.taskId : undefined;
  if (!flowId || !taskId) return;

  void queryClient.invalidateQueries({ queryKey: playbookKeys.flowReplays(flowId, taskId) });
  void queryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'enriched') });
}

function isHitlPolicy(value: unknown): value is HitlPolicy {
  return typeof value === 'object' && value !== null && 'mode' in value && 'sensitivity' in value;
}

function isHitlMemory(value: unknown): value is HitlMemory {
  return typeof value === 'object' && value !== null && 'id' in value && 'flowId' in value;
}

function isActiveExecutionStatus(status: string | null | undefined) {
  return status === 'queued' || status === 'running' || status === 'interrupted' || status === 'pending_approval';
}
