import { describe, expect, it } from 'vitest';

import type { PlaybookExecution, TaskResult } from '../types';
import {
  buildAdvisorExecutionPoints,
  calculateAdvisorEvaluationMetrics,
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

function makeTaskResult(overallScore: number | null, iteration = 0): TaskResult {
  return {
    taskId: 'task-1',
    nodeTitle: 'Plan optimization',
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
});
