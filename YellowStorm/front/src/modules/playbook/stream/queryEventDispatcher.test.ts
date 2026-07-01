import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import { playbookKeys } from '@/modules/playbook/query/queryKeys';
import type { HitlBlockerRule, HitlMemory, HitlPolicy, Playbook, PlaybookExecution } from '@/modules/playbook/types';
import { dispatchPlaybookStreamEvent } from './queryEventDispatcher';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeExecution(overrides: Partial<PlaybookExecution> = {}): PlaybookExecution {
  return {
    id: 'exec-1',
    playbookId: 'playbook-1',
    executedBy: '',
    executionNumber: 1,
    status: 'running',
    executionTrigger: 'manual',
    taskResults: [],
    threadId: null,
    interruptPayload: null,
    waitingForHumanInput: false,
    currentInterruptId: null,
    currentInterruptTaskId: null,
    hitlHistory: [],
    error: null,
    durationMs: null,
    startedAt: '2026-05-30T00:00:00.000Z',
    completedAt: null,
    singleStepTaskId: null,
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('query-backed playbook stream dispatcher', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeClient();
  });

  it('hydrates active executions and detail cache from connected events', () => {
    const execution = makeExecution();

    dispatchPlaybookStreamEvent({
      type: 'playbook_connected',
      data: { activeExecutions: [execution] },
    }, { queryClient });

    expect(queryClient.getQueryData(playbookKeys.activeExecutions())).toEqual([execution]);
    expect(queryClient.getQueryData(playbookKeys.execution('exec-1'))).toEqual(execution);
  });

  it('merges step updates into execution detail without requiring Zustand state', () => {
    dispatchPlaybookStreamEvent({
      type: 'playbook_execution_start',
      data: {
        executionId: 'exec-1',
        playbookId: 'playbook-1',
        executionNumber: 1,
        status: 'running',
        taskResults: [],
      },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_step_update',
      data: { executionId: 'exec-1', taskId: 'task-1', status: 'running', output: 'partial' },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_step_update',
      data: {
        executionId: 'exec-1',
        taskId: 'task-1',
        status: 'running',
        toolTrace: [{ callIndex: 0, toolName: 'search', args: {}, status: 'completed' }],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generatedOutput: 'answer' }],
        totalTokens: 3,
        modelName: 'gpt-5.4-mini',
      },
    }, { queryClient });

    expect(queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution('exec-1'))?.taskResults[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        output: 'partial',
        toolTrace: [{ callIndex: 0, toolName: 'search', args: {}, status: 'completed' }],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generatedOutput: 'answer' }],
        totalTokens: 3,
        modelName: 'gpt-5.4-mini',
      }),
    );

    dispatchPlaybookStreamEvent({
      type: 'playbook_step_complete',
      data: { executionId: 'exec-1', taskId: 'task-1', status: 'completed', output: 'final' },
    }, { queryClient });

    const execution = queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution('exec-1'));
    expect(execution?.taskResults).toEqual([
      expect.objectContaining({ taskId: 'task-1', status: 'completed', output: 'final' }),
    ]);
  });

  it('normalizes automatic judge SSE metrics in the query execution cache', () => {
    queryClient.setQueryData(playbookKeys.execution('exec-1'), makeExecution({
      taskResults: [{ taskId: 'task-1', status: 'completed', judgeStatus: 'evaluating', judgeResult: null } as PlaybookExecution['taskResults'][number]],
    }));

    dispatchPlaybookStreamEvent({
      type: 'playbook_step_judge_updated',
      data: {
        executionId: 'exec-1',
        taskId: 'task-1',
        judgeStatus: 'evaluated',
        judgeResult: {
          accuracy_score: 96,
          completeness_score: 92,
          result_matching_score: 98,
          overall_score: 95,
          confidence: 94,
          tool_usage_score: 90,
          relevance_score: 99,
          specificity_score: 93,
          format_compliance_score: 88,
          evidence_grounding_score: 97,
          handoff_readiness_score: 94,
          hitl_appropriateness_score: 98,
          determinism_score: 96,
          cost_efficiency_score: 84,
          step_optimization_priority: 28,
          playbook_optimization_priority: 41,
          cost_optimization_priority: 22,
        } as any,
        judgeHistoryEntry: {
          id: 'judge-1',
          created_at: '2026-06-04T20:00:00.000Z',
          attempt_number: 1,
          scoring_mode: 'llm',
          judge_result: {
            accuracy_score: 96,
            completeness_score: 92,
            result_matching_score: 98,
            overall_score: 95,
            confidence: 94,
            tool_usage_score: 90,
            relevance_score: 99,
            specificity_score: 93,
            format_compliance_score: 88,
            evidence_grounding_score: 97,
            handoff_readiness_score: 94,
            hitl_appropriateness_score: 98,
            determinism_score: 96,
            cost_efficiency_score: 84,
            step_optimization_priority: 28,
            playbook_optimization_priority: 41,
            cost_optimization_priority: 22,
          },
        } as any,
      },
    }, { queryClient });

    const execution = queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution('exec-1'));
    expect(execution?.taskResults[0].judgeResult).toMatchObject({
      accuracyScore: 96,
      overallScore: 95,
      relevanceScore: 99,
      specificityScore: 93,
      formatComplianceScore: 88,
      evidenceGroundingScore: 97,
      handoffReadinessScore: 94,
      hitlAppropriatenessScore: 98,
      determinismScore: 96,
      costEfficiencyScore: 84,
      stepOptimizationPriority: 28,
      playbookOptimizationPriority: 41,
      costOptimizationPriority: 22,
    });
    expect(execution?.taskResults[0].judgeHistory?.[0].judgeResult).toMatchObject({
      relevanceScore: 99,
      specificityScore: 93,
      formatComplianceScore: 88,
      evidenceGroundingScore: 97,
      handoffReadinessScore: 94,
      hitlAppropriatenessScore: 98,
      determinismScore: 96,
      costEfficiencyScore: 84,
      stepOptimizationPriority: 28,
      playbookOptimizationPriority: 41,
      costOptimizationPriority: 22,
    });
  });

  it('removes terminal executions from the active cache and updates history status', () => {
    const execution = makeExecution();
    queryClient.setQueryData(playbookKeys.execution('exec-1'), execution);
    queryClient.setQueryData(playbookKeys.activeExecutions(), [execution]);
    queryClient.setQueryData(playbookKeys.executions('playbook-1'), [
      { id: 'exec-1', playbookId: 'playbook-1', status: 'running' },
    ]);

    dispatchPlaybookStreamEvent({
      type: 'playbook_execution_complete',
      data: { executionId: 'exec-1', status: 'completed', durationMs: 10 },
    }, { queryClient });

    expect(queryClient.getQueryData(playbookKeys.activeExecutions())).toEqual([]);
    expect(queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution('exec-1'))?.status).toBe('completed');
    expect(queryClient.getQueryData(playbookKeys.executions('playbook-1'))).toEqual([
      expect.objectContaining({ id: 'exec-1', status: 'completed' }),
    ]);
  });

  it('patches replay and output-format task metadata in playbook detail caches', () => {
    const playbook = {
      id: 'playbook-1',
      tasks: [{ id: 'task-1', title: 'Task' }],
    } as Playbook;
    queryClient.setQueryData(playbookKeys.detail('playbook-1', 'enriched'), playbook);

    dispatchPlaybookStreamEvent({
      type: 'playbook_output_format_template_updated',
      data: {
        playbookId: 'playbook-1',
        taskId: 'task-1',
        template: {
          id: 'template-1',
          playbookId: 'playbook-1',
          taskId: 'task-1',
          sourceExecutionId: 'exec-1',
          sourceExecutionNumber: 1,
          status: 'active',
          templateVersion: 3,
          generationStatus: 'ready',
          generationError: null,
          formatGuide: '',
          createdAt: '2026-05-30T00:00:00.000Z',
          updatedAt: '2026-05-30T00:00:00.000Z',
        },
      },
    }, { queryClient });

    const updated = queryClient.getQueryData<Playbook>(playbookKeys.detail('playbook-1', 'enriched'));
    expect(updated?.tasks[0]).toMatchObject({
      hasOutputFormatTemplate: true,
      activeOutputFormatTemplateId: 'template-1',
      activeOutputFormatTemplateVersion: 3,
    });
  });

  it('updates HITL query caches from policy, blocker, and memory stream events', () => {
    const execution = makeExecution();
    const policy: HitlPolicy = {
      mode: 'auto',
      sensitivity: 'strict',
      clarificationEnabled: true,
      approvalEnabled: true,
      reviewEnabled: true,
      propagateFeedbackDefault: true,
      defaultFeedbackScope: 'downstream_run',
    };
    const blocker = {
      id: 'rule-1',
      enabled: true,
      scope: 'workflow',
    } as HitlBlockerRule;
    const memory = {
      id: 'memory-1',
      flowId: 'playbook-1',
    } as HitlMemory;

    queryClient.setQueryData(playbookKeys.execution('exec-1'), execution);
    queryClient.setQueryData(playbookKeys.hitlBlockers('playbook-1'), [blocker]);

    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_policy_updated',
      data: { executionId: 'exec-1', policy },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_blocker_disabled',
      data: { executionId: 'exec-1', blockerId: 'rule-1' },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_memory_saved',
      data: { executionId: 'exec-1', memory },
    }, { queryClient });

    expect(queryClient.getQueryData(playbookKeys.hitlPolicy('playbook-1'))).toEqual(policy);
    expect(queryClient.getQueryData<HitlBlockerRule[]>(playbookKeys.hitlBlockers('playbook-1'))?.[0].enabled).toBe(false);
    expect(queryClient.getQueryData(playbookKeys.hitlMemories('playbook-1'))).toEqual([memory]);
  });

  it('merges HITL interrupt lifecycle events into execution cache', () => {
    queryClient.setQueryData(playbookKeys.execution('exec-1'), makeExecution({
      taskResults: [{ taskId: 'task-1', status: 'running' } as PlaybookExecution['taskResults'][number]],
    }));

    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_interrupt_created',
      data: {
        executionId: 'exec-1',
        taskId: 'task-1',
        type: 'clarification',
        message: 'Which signed contract should I use?',
        threadId: 'thread-1',
        interruptId: 'interrupt-1',
        resumableActions: ['reply'],
        feedbackScopeDefault: 'downstream_run',
      },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_interrupt_updated',
      data: {
        executionId: 'exec-1',
        interruptId: 'interrupt-1',
        message: 'Which final signed contract should I use?',
      },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_hitl_interrupt_resolved',
      data: {
        executionId: 'exec-1',
        interruptId: 'interrupt-1',
        taskId: 'task-1',
        action: 'reply',
        scope: 'downstream_run',
        remember: true,
      },
    }, { queryClient });

    const execution = queryClient.getQueryData<PlaybookExecution>(playbookKeys.execution('exec-1'));
    expect(execution).toMatchObject({
      status: 'running',
      waitingForHumanInput: false,
      currentInterruptId: null,
      currentInterruptTaskId: null,
      pendingInterrupts: [],
    });
    expect(execution?.hitlHistory?.[0]).toMatchObject({
      interruptId: 'interrupt-1',
      status: 'answered',
      responseAction: 'reply',
      responseScope: 'downstream_run',
      responseRemember: true,
      message: 'Which final signed contract should I use?',
    });
  });

  it('preserves node-scoped HITL policy across execution churn events', () => {
    const nodePolicy: HitlPolicy = {
      mode: 'off',
      sensitivity: 'minimal',
      clarificationEnabled: false,
      approvalEnabled: false,
      reviewEnabled: false,
      propagateFeedbackDefault: false,
      defaultFeedbackScope: 'downstream_run',
    };
    queryClient.setQueryData(playbookKeys.hitlPolicy('playbook-1', 'task-1'), nodePolicy);
    queryClient.setQueryData(playbookKeys.execution('exec-1'), makeExecution());

    dispatchPlaybookStreamEvent({
      type: 'playbook_step_start',
      data: { executionId: 'exec-1', taskId: 'task-1', status: 'running' },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_step_update',
      data: { executionId: 'exec-1', taskId: 'task-1', status: 'running', output: 'partial' },
    }, { queryClient });
    dispatchPlaybookStreamEvent({
      type: 'playbook_step_complete',
      data: { executionId: 'exec-1', taskId: 'task-1', status: 'completed', output: 'final' },
    }, { queryClient });

    expect(queryClient.getQueryData(playbookKeys.hitlPolicy('playbook-1', 'task-1'))).toEqual(nodePolicy);
  });
});
