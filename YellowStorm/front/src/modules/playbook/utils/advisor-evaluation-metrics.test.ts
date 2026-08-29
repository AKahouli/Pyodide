import { describe, expect, it } from 'vitest';

import type { PlaybookExecution, PlaybookTask, TaskResult } from '../types';
import {
  buildAdvisorExecutionPoints,
  buildAdvisorWholeExecutionPoints,
  calculateAdvisorEvaluationMetrics,
  calculateAdvisorWholeEvaluationMetrics,
  getAdvisorAttempts,
  normalizeAdvisorScore,
  selectTaskResult,
} from './advisor-evaluation-metrics';

function makeJudgeResult(overallScore: number): NonNullable<TaskResult['judgeResult']> {
  return {
    overallScore,
    accuracyScore: overallScore,
    completenessScore: overallScore,
    resultMatchingScore: overallScore,
    confidence: 0.8,
    toolUsageScore: overallScore,
    expectedResultSource: 'node_field',
    expectedResultType: 'semantic_description',
    expectedResultMatched: true,
    expectedResultReason: 'Matched',
    missingFacts: [],
    incoherences: [],
    unsupportedClaims: [],
    handoffRisks: [],
    rewriteHints: [],
    toolSelectionIssues: [],
    missingToolCalls: [],
    redundantToolCalls: [],
    toolOutputUseIssues: [],
    toolSequencingIssues: [],
    toolUsageStrengths: [],
    toolUsageRecommendation: '',
    safeAutoFixType: 'none',
    recommendation: 'none',
    reason: '',
  };
}

function makeTaskResult(overallScore: number | null, iteration = 0, taskId = 'task-1'): TaskResult {
  return {
    taskId,
    nodeTitle: taskId,
    agentName: 'Advisor',
    order: 1,
    iteration,
    status: 'completed',
    output: `Output ${overallScore}`,
    error: null,
    durationMs: 100,
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:01:00.000Z',
    judgeStatus: overallScore === null ? 'idle' : 'evaluated',
    judgeResult: overallScore === null ? null : makeJudgeResult(overallScore),
  };
}

function makeExecution(number: number, score: number | null): PlaybookExecution {
  return {
    id: `execution-${number}`,
    playbookId: 'playbook-1',
    executedBy: 'user-1',
    executionNumber: number,
    status: 'completed',
    taskResults: [makeTaskResult(score)],
    threadId: null,
    interruptPayload: null,
    error: null,
    durationMs: 100,
    startedAt: '2026-08-28T10:00:00.000Z',
    completedAt: '2026-08-28T10:01:00.000Z',
    singleStepTaskId: null,
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:01:00.000Z',
  };
}

describe('advisor evaluation metrics', () => {
  it('normalizes fractional and percentage scores', () => {
    expect(normalizeAdvisorScore(0.82)).toBe(82);
    expect(normalizeAdvisorScore(82)).toBe(82);
    expect(normalizeAdvisorScore(140)).toBe(100);
    expect(normalizeAdvisorScore(Number.NaN)).toBeNull();
  });

  it('uses the highest completed iteration for one execution data point', () => {
    const execution = makeExecution(1, 40);
    execution.taskResults.push(makeTaskResult(75, 2));
    execution.taskResults.push({ ...makeTaskResult(90, 3), status: 'running' });

    expect(selectTaskResult(execution, 'task-1')?.iteration).toBe(2);
    expect(buildAdvisorExecutionPoints([execution], 'task-1')).toHaveLength(1);
  });

  it('keeps Advisor attempts under the same generated result', () => {
    const taskResult = makeTaskResult(72);
    taskResult.judgeHistory = [
      { id: 'attempt-1', createdAt: '2026-08-28T10:00:00.000Z', attemptNumber: 1, model: null, scoringMode: 'llm', judgeResult: makeJudgeResult(62) },
      { id: 'attempt-2', createdAt: '2026-08-28T10:05:00.000Z', attemptNumber: 2, model: null, scoringMode: 'llm', judgeResult: makeJudgeResult(72) },
    ];

    const attempts = getAdvisorAttempts(taskResult);
    expect(attempts.map((attempt) => attempt.id)).toEqual(['attempt-2', 'attempt-1']);
  });

  it('separates low quality from stable scoring and preserves coverage', () => {
    const points = buildAdvisorExecutionPoints([
      makeExecution(3, 41),
      makeExecution(2, 43),
      makeExecution(1, null),
    ], 'task-1');

    const metrics = calculateAdvisorEvaluationMetrics(points);
    expect(metrics.averageScore).toBe(42);
    expect(metrics.variation).toBe(1);
    expect(metrics.quality).toBe('low');
    expect(metrics.stability).toBe('stable');
    expect(metrics.evaluatedCount).toBe(2);
    expect(metrics.eligibleCount).toBe(3);
    expect(metrics.passedCount).toBe(0);
  });

  it('averages eligible step scores equally and keeps missing evaluations out of quality', () => {
    const tasks = [
      { id: 'task-1', title: 'Research', executionOrder: 1, enabled: true },
      { id: 'task-2', title: 'Draft', executionOrder: 2, enabled: true },
    ] as PlaybookTask[];
    const complete = makeExecution(2, 60);
    complete.taskResults.push(makeTaskResult(100, 0, 'task-2'));
    const partial = makeExecution(1, 90);
    partial.taskResults.push(makeTaskResult(null, 0, 'task-2'));

    const points = buildAdvisorWholeExecutionPoints([complete, partial], tasks);
    const metrics = calculateAdvisorWholeEvaluationMetrics(points);

    expect(points.map((point) => point.overallScore)).toEqual([80, 90]);
    expect(points.map((point) => point.state)).toEqual(['pass', 'partial']);
    expect(metrics.averageScore).toBe(85);
    expect(metrics.variation).toBe(5);
    expect(metrics.evaluatedStepCount).toBe(3);
    expect(metrics.eligibleStepCount).toBe(4);
    expect(metrics.passedCount).toBe(1);
  });

  it('never passes a single-step execution even with full evaluation coverage', () => {
    const execution = makeExecution(1, 95);
    execution.singleStepTaskId = 'task-1';
    const tasks = [{ id: 'task-1', title: 'Research', executionOrder: 1, enabled: true }] as PlaybookTask[];

    expect(buildAdvisorWholeExecutionPoints([execution], tasks)[0].state).toBe('partial');
  });

  it('uses historical snapshot task IDs, titles, and eligibility', () => {
    const execution = makeExecution(1, 75);
    execution.taskResults[0].taskId = 'removed-task';
    execution.snapshot = {
      nodes: [
        { id: 'removed-task', kind: 'step', label: 'Historical research', metadata: { executionOrder: 2 } },
        { id: 'iterator-task', kind: 'iterator', label: 'Historical iterator', metadata: { executionOrder: 3 } },
        { id: 'disabled-task', kind: 'step', label: 'Disabled', metadata: { enabled: false, executionOrder: 1 } },
      ],
    };

    const points = buildAdvisorWholeExecutionPoints([execution], []);

    expect(points[0].steps).toEqual(expect.arrayContaining([expect.objectContaining({
      taskId: 'removed-task',
      title: 'Historical research',
      overallScore: 75,
    }), expect.objectContaining({
      taskId: 'iterator-task',
      title: 'Historical iterator',
    })]));
    expect(points[0].eligibleCount).toBe(1);
  });
});
