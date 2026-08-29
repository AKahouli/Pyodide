import type { PlaybookExecution, PlaybookTask, TaskResult } from '../types';

export const ADVISOR_PASS_SCORE = 80;

export type AdvisorJudgeResult = NonNullable<TaskResult['judgeResult']>;
export type AdvisorHistoryAttempt = NonNullable<TaskResult['judgeHistory']>[number];

export interface AdvisorAttempt {
  id: string;
  createdAt: string | null;
  attemptNumber: number | null;
  result: AdvisorJudgeResult;
}

export interface AdvisorExecutionPoint {
  execution: PlaybookExecution;
  taskResult: TaskResult | null;
  attempts: AdvisorAttempt[];
  latestResult: AdvisorJudgeResult | null;
  overallScore: number | null;
}

export interface AdvisorEvaluationMetrics {
  averageScore: number | null;
  variation: number | null;
  passedCount: number;
  evaluatedCount: number;
  eligibleCount: number;
  quality: 'high' | 'medium' | 'low' | 'unavailable';
  stability: 'stable' | 'moderate' | 'variable' | 'insufficient';
}

export type AdvisorWholeExecutionState = 'pass' | 'fail' | 'partial' | 'unavailable';

export interface AdvisorWholeStepPoint {
  taskId: string;
  title: string;
  order: number;
  taskResult: TaskResult | null;
  attempts: AdvisorAttempt[];
  latestResult: AdvisorJudgeResult | null;
  overallScore: number | null;
}

export interface AdvisorWholeExecutionPoint {
  execution: PlaybookExecution;
  steps: AdvisorWholeStepPoint[];
  overallScore: number | null;
  evaluatedCount: number;
  eligibleCount: number;
  state: AdvisorWholeExecutionState;
}

export interface AdvisorWholeEvaluationMetrics {
  averageScore: number | null;
  variation: number | null;
  passedCount: number;
  executionCount: number;
  evaluatedExecutionCount: number;
  evaluatedStepCount: number;
  eligibleStepCount: number;
  quality: AdvisorEvaluationMetrics['quality'];
  stability: AdvisorEvaluationMetrics['stability'];
}

export const ADVISOR_SCORE_DIMENSIONS = [
  'overallScore',
  'accuracyScore',
  'completenessScore',
  'resultMatchingScore',
  'toolUsageScore',
  'relevanceScore',
  'specificityScore',
  'formatComplianceScore',
  'evidenceGroundingScore',
  'handoffReadinessScore',
  'hitlAppropriatenessScore',
  'determinismScore',
  'costEfficiencyScore',
] as const satisfies ReadonlyArray<keyof AdvisorJudgeResult>;

export type AdvisorScoreDimension = typeof ADVISOR_SCORE_DIMENSIONS[number];

export function normalizeAdvisorScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const percentage = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percentage));
}

export function selectTaskResult(execution: PlaybookExecution, taskId: string): TaskResult | null {
  const results = execution.taskResults.filter(
    (result) => result.taskId === taskId && result.status === 'completed',
  );
  if (results.length === 0) return null;

  return results.reduce((latest, result) =>
    (result.iteration ?? 0) >= (latest.iteration ?? 0) ? result : latest,
  );
}

function compareAttempts(left: AdvisorHistoryAttempt, right: AdvisorHistoryAttempt): number {
  const attemptDelta = (right.attemptNumber ?? -1) - (left.attemptNumber ?? -1);
  if (attemptDelta !== 0) return attemptDelta;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export function getAdvisorAttempts(taskResult: TaskResult | null): AdvisorAttempt[] {
  if (!taskResult) return [];
  const history = [...(taskResult.judgeHistory ?? [])].sort(compareAttempts);
  if (history.length > 0) {
    return history.map((attempt) => ({
      id: attempt.id,
      createdAt: attempt.createdAt,
      attemptNumber: attempt.attemptNumber,
      result: attempt.judgeResult,
    }));
  }
  if (!taskResult.judgeResult) return [];

  return [{
    id: 'current',
    createdAt: taskResult.completedAt,
    attemptNumber: taskResult.attemptNumber ?? null,
    result: taskResult.judgeResult,
  }];
}

export function buildAdvisorExecutionPoints(
  executions: PlaybookExecution[],
  taskId: string,
): AdvisorExecutionPoint[] {
  return [...executions]
    .sort((left, right) => right.executionNumber - left.executionNumber)
    .map((execution) => {
      const taskResult = selectTaskResult(execution, taskId);
      const attempts = getAdvisorAttempts(taskResult);
      const latestResult = attempts[0]?.result ?? null;
      return {
        execution,
        taskResult,
        attempts,
        latestResult,
        overallScore: normalizeAdvisorScore(latestResult?.overallScore),
      };
    });
}

function isAdvisorEligibleTask(task: PlaybookTask): boolean {
  return task.enabled !== false
    && task.taskType !== 'evaluation'
    && task.disableAdvisorEvaluation !== true;
}

function resolveExecutionTaskCatalog(
  execution: PlaybookExecution,
  currentTasks: PlaybookTask[],
): Array<{ id: string; title: string; order: number }> {
  const snapshotNodes = execution.snapshot?.nodes;
  if (Array.isArray(snapshotNodes) && snapshotNodes.length > 0) {
    return snapshotNodes
      .filter((node) => {
        const metadata = node.metadata ?? {};
        return (node.kind === 'step' || node.kind === 'iterator')
          && metadata.enabled !== false
          && metadata.taskType !== 'evaluation'
          && metadata.disableAdvisorEvaluation !== true
          && metadata.disable_advisor_evaluation !== true;
      })
      .map((node, index) => ({
        id: node.id,
        title: node.label || String(node.metadata?.title ?? node.id),
        order: typeof node.metadata?.executionOrder === 'number' ? node.metadata.executionOrder : index,
      }))
      .sort((left, right) => left.order - right.order);
  }

  const legacyTasks = (execution.playbookSnapshot as { tasks?: PlaybookTask[] } | null)?.tasks;
  const tasks = Array.isArray(legacyTasks) && legacyTasks.length > 0 ? legacyTasks : currentTasks;
  return tasks
    .filter(isAdvisorEligibleTask)
    .map((task) => ({ id: task.id, title: task.title, order: task.executionOrder }))
    .sort((left, right) => left.order - right.order);
}

export function buildAdvisorWholeExecutionPoints(
  executions: PlaybookExecution[],
  currentTasks: PlaybookTask[],
): AdvisorWholeExecutionPoint[] {
  return [...executions]
    .sort((left, right) => right.executionNumber - left.executionNumber)
    .map((execution) => {
      const steps = resolveExecutionTaskCatalog(execution, currentTasks).map((task) => {
        const taskResult = selectTaskResult(execution, task.id);
        const attempts = getAdvisorAttempts(taskResult);
        const latestResult = attempts[0]?.result ?? null;
        return {
          taskId: task.id,
          title: task.title,
          order: task.order,
          taskResult,
          attempts,
          latestResult,
          overallScore: normalizeAdvisorScore(latestResult?.overallScore),
        };
      });
      const eligible = steps.filter((step) => step.taskResult !== null);
      const scores = eligible
        .map((step) => step.overallScore)
        .filter((score): score is number => score !== null);
      const overallScore = scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : null;
      const hasCompleteCoverage = eligible.length > 0 && scores.length === eligible.length;
      const state: AdvisorWholeExecutionState = eligible.length === 0 || overallScore === null
        ? 'unavailable'
        : execution.singleStepTaskId !== null || !hasCompleteCoverage
          ? 'partial'
          : overallScore >= ADVISOR_PASS_SCORE ? 'pass' : 'fail';

      return {
        execution,
        steps,
        overallScore,
        evaluatedCount: scores.length,
        eligibleCount: eligible.length,
        state,
      };
    });
}

function calculateScoreStats(scores: number[]): Pick<AdvisorEvaluationMetrics, 'averageScore' | 'variation' | 'quality' | 'stability'> {
  const averageScore = scores.length > 0
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;
  const variation = scores.length >= 2 && averageScore !== null
    ? Math.sqrt(scores.reduce((sum, score) => sum + ((score - averageScore) ** 2), 0) / scores.length)
    : null;
  return {
    averageScore,
    variation,
    quality: averageScore === null
      ? 'unavailable'
      : averageScore >= ADVISOR_PASS_SCORE
        ? 'high'
        : averageScore >= 60 ? 'medium' : 'low',
    stability: variation === null
      ? 'insufficient'
      : variation <= 5 ? 'stable' : variation <= 10 ? 'moderate' : 'variable',
  };
}

export function calculateAdvisorWholeEvaluationMetrics(
  points: AdvisorWholeExecutionPoint[],
): AdvisorWholeEvaluationMetrics {
  const scores = points
    .map((point) => point.overallScore)
    .filter((score): score is number => score !== null);
  return {
    ...calculateScoreStats(scores),
    passedCount: points.filter((point) => point.state === 'pass').length,
    executionCount: points.length,
    evaluatedExecutionCount: scores.length,
    evaluatedStepCount: points.reduce((sum, point) => sum + point.evaluatedCount, 0),
    eligibleStepCount: points.reduce((sum, point) => sum + point.eligibleCount, 0),
  };
}

export function calculateAdvisorEvaluationMetrics(
  points: AdvisorExecutionPoint[],
): AdvisorEvaluationMetrics {
  const eligible = points.filter((point) => point.taskResult !== null);
  const scores = eligible
    .map((point) => point.overallScore)
    .filter((score): score is number => score !== null);
  const stats = calculateScoreStats(scores);

  return {
    ...stats,
    passedCount: scores.filter((score) => score >= ADVISOR_PASS_SCORE).length,
    evaluatedCount: scores.length,
    eligibleCount: eligible.length,
  };
}

export function getDimensionScore(
  result: AdvisorJudgeResult | null,
  dimension: AdvisorScoreDimension,
): number | null {
  return normalizeAdvisorScore(result?.[dimension] as number | null | undefined);
}
