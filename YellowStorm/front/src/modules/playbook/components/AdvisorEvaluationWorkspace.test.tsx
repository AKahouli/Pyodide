import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { PlaybookExecution, PlaybookTask, TaskResult } from '../types';
import { buildAdvisorExecutionPoints } from '../utils/advisor-evaluation-metrics';
import { AdvisorExecutionComparison } from './AdvisorExecutionComparison';
import { AdvisorEvaluationWorkspace } from './AdvisorEvaluationWorkspace';

const evaluationDataMock = vi.hoisted(() => ({
  executions: [] as PlaybookExecution[],
  loading: false,
  error: false,
  unavailableCount: 0,
  refresh: vi.fn(),
}));

vi.mock('../hooks/useAdvisorEvaluationData', () => ({
  useAdvisorEvaluationData: () => evaluationDataMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));

function makeJudgeResult(score: number): NonNullable<TaskResult['judgeResult']> {
  return {
    overallScore: score,
    accuracyScore: score - 2,
    completenessScore: score - 4,
    resultMatchingScore: score - 1,
    confidence: 0.9,
    toolUsageScore: score + 1,
    relevanceScore: score,
    specificityScore: score,
    formatComplianceScore: score,
    evidenceGroundingScore: score,
    handoffReadinessScore: score,
    hitlAppropriatenessScore: score,
    determinismScore: score,
    costEfficiencyScore: score,
    stepOptimizationPriority: 95,
    playbookOptimizationPriority: 90,
    costOptimizationPriority: 85,
    expectedResultSource: 'node_field',
    expectedResultType: 'semantic_description',
    expectedResultMatched: true,
    expectedResultReason: 'Matched',
    missingFacts: [], incoherences: [], unsupportedClaims: [], handoffRisks: [], rewriteHints: [],
    toolSelectionIssues: [], missingToolCalls: [], redundantToolCalls: [], toolOutputUseIssues: [], toolSequencingIssues: [], toolUsageStrengths: [],
    toolUsageRecommendation: '', safeAutoFixType: 'none', recommendation: 'none', reason: '',
  };
}

function makeExecution(number: number, score: number, output: string): PlaybookExecution {
  const taskResult: TaskResult = {
    taskId: 'task-1', nodeTitle: 'Plan optimization', agentName: 'Advisor', order: 1, status: 'completed',
    output, error: null, durationMs: 100, startedAt: '2026-08-28T10:00:00.000Z', completedAt: '2026-08-28T10:01:00.000Z',
    judgeStatus: 'evaluated', judgeResult: makeJudgeResult(score),
  };
  return {
    id: `execution-${number}`, playbookId: 'playbook-1', executedBy: 'user-1', executionNumber: number, status: 'completed',
    taskResults: [taskResult], threadId: null, interruptPayload: null, error: null, durationMs: 100,
    startedAt: '2026-08-28T10:00:00.000Z', completedAt: '2026-08-28T10:01:00.000Z', singleStepTaskId: null,
    playbookSnapshot: null, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
    createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:01:00.000Z',
  };
}

const task = {
  id: 'task-1', title: 'Plan optimization', executionOrder: 1, enabled: true,
} as PlaybookTask;

describe('AdvisorEvaluationWorkspace', () => {
  beforeEach(() => {
    evaluationDataMock.executions = [makeExecution(2, 82, 'Second generated result'), makeExecution(1, 62, 'First generated result')];
    evaluationDataMock.loading = false;
    evaluationDataMock.error = false;
    evaluationDataMock.unavailableCount = 0;
  });

  it('defines every summary KPI for business users', () => {
    render(<AdvisorEvaluationWorkspace playbookId="playbook-1" tasks={[task]} enabled />);

    expect(screen.getByRole('button', { name: /evaluationWorkspace.kpi.average: evaluationWorkspace.tooltip.average/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /evaluationWorkspace.kpi.variation: evaluationWorkspace.tooltip.variation/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /evaluationWorkspace.kpi.passRate: evaluationWorkspace.tooltip.passRate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /evaluationWorkspace.kpi.coverage: evaluationWorkspace.tooltip.coverage/ })).toBeInTheDocument();
  });

  it('describes the summary with a sentence-compatible stability adjective', () => {
    render(<AdvisorEvaluationWorkspace playbookId="playbook-1" tasks={[task]} enabled />);

    expect(screen.getByText(/evaluationWorkspace\.summaryDescription \{"quality":"evaluationworkspace\.quality\.medium","stability":"evaluationWorkspace\.summaryStability\.moderate"\}/)).toBeInTheDocument();
  });

  it('uses the insufficient-data summary wording when consistency cannot be computed', () => {
    evaluationDataMock.executions = [makeExecution(1, 82, 'Only generated result')];
    render(<AdvisorEvaluationWorkspace playbookId="playbook-1" tasks={[task]} enabled />);

    expect(screen.getByText(/evaluationWorkspace\.summaryDescriptionInsufficient \{"quality":"evaluationworkspace\.quality\.high"\}/)).toBeInTheDocument();
  });

  it('compares Advisor dimensions and generated results without priority or confidence attributes', async () => {
    const points = buildAdvisorExecutionPoints(evaluationDataMock.executions, 'task-1');
    render(<TooltipProvider><AdvisorExecutionComparison points={points} /></TooltipProvider>);

    expect(await screen.findByText('First generated result')).toBeInTheDocument();
    expect(screen.getByText('Second generated result')).toBeInTheDocument();
    expect(screen.getByText('evaluationWorkspace.dimension.accuracyScore')).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OptimizationPriority/i)).not.toBeInTheDocument();
  });
});
