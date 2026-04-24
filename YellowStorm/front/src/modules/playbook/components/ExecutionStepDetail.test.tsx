import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionStepDetail } from './ExecutionStepDetail';
import type { PlaybookExecution, TaskResult } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  currentPlaybook: null as any,
  deleteExecution: vi.fn(),
  deleteStepExecution: vi.fn(),
  updatePlaybookFromJudge: vi.fn(),
  generatePlaybookFromJudge: vi.fn(),
  optimizeStepFromJudge: vi.fn(),
  fetchAdvisorRemediations: vi.fn().mockResolvedValue([]),
  applyAdvisorRemediations: vi.fn().mockResolvedValue(null),
  validateTaskReplay: vi.fn(),
  fetchTaskReplays: vi.fn().mockResolvedValue([]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span data-testid="badge">{status}</span>,
}));

vi.mock('@/components/ai-elements/ai-message-content', () => ({
  AIMessageContent: ({ parts }: any) => <div data-testid="ai-content">{JSON.stringify(parts)}</div>,
}));

vi.mock('@/components/ai-elements/message-context', () => ({
  MessageProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/modules/conversation/utils', () => ({
  mapComponentsToContentParts: (items: any[]) => items,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('./HumanFeedbackInline', () => ({
  HumanFeedbackInline: ({ data }: any) => <div data-testid="hf">{data.message}</div>,
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: any) => selector(storeState),
}));

const baseStep: TaskResult = {
  taskId: 't1',
  nodeTitle: 'Analyze Data',
  agentName: 'Analyzer',
  order: 1,
  status: 'completed',
  output: 'Result text here',
  error: null,
  durationMs: 5200,
  startedAt: '2025-01-01T00:00:00.000Z',
  completedAt: '2025-01-01T00:00:05.200Z',
};

describe('ExecutionStepDetail', () => {
  it('renders replay and output-format badges immediately from task state and opens the format editor', async () => {
    const onOpenOutputFormatEditor = vi.fn();
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{
        id: 't1',
        title: 'Analyze Data',
        description: '',
        assignedAgentId: null,
        executionOrder: 0,
        positionX: 0,
        positionY: 0,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: false,
        clarificationPrompt: '',
        maxClarifications: 0,
        inputKeys: [],
        outputKey: '',
        notifyOnComplete: false,
        notifyEmails: [],
        inputFiles: [],
        hasValidatedReplay: true,
        activeReplayVersion: 4,
        isSavingReplayBaseline: true,
        hasOutputFormatTemplate: true,
        activeOutputFormatTemplateVersion: 2,
        activeOutputFormatStatus: 'pending',
        isCapturingOutputFormat: true,
      }],
    };

    render(
      <ExecutionStepDetail
        step={baseStep}
        onOpenOutputFormatEditor={onOpenOutputFormatEditor}
      />,
    );

    expect(screen.getByText('detail.badges.replayBaseline')).toBeInTheDocument();
    expect(screen.getByText('detail.badges.outputFormatTemplate')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'detail.badges.outputFormatTemplate' }));
    expect(onOpenOutputFormatEditor).toHaveBeenCalledWith('t1');

    storeState.currentPlaybook = null;
  });

  it('shows placeholder when no step is selected', () => {
    render(<ExecutionStepDetail step={null} />);
    expect(screen.getByText('execution.selectStep')).toBeInTheDocument();
  });

  it('renders step title and status badge', () => {
    render(<ExecutionStepDetail step={baseStep} />);
    expect(screen.getByText('Analyze Data')).toBeInTheDocument();
  });

  it('navigates to the newly generated playbook from the judge CTA', async () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1' }],
    };
    storeState.generatePlaybookFromJudge.mockResolvedValueOnce({ id: 'p2' });

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: {
            accuracyScore: 80,
            completenessScore: 90,
            overallScore: 85,
            confidence: 0.84,
            toolUsageScore: 78,
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
            recommendation: 'generate_new_optimized_playbook',
            reason: 'Create a new playbook.',
          },
        }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [baseStep],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: 1000,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:01.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'detail.judge.generateOptimizedPlaybook' }));

    expect(storeState.generatePlaybookFromJudge).toHaveBeenCalledWith('p1', 'exec-1');
    expect(navigateMock).toHaveBeenCalledWith('/playbooks/p2');

    storeState.currentPlaybook = null;
  });

  it('shows a step execution picker in the results tab when history exists', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          attemptNumber: 3,
          stepExecutions: [
            {
              id: 'step-exec-2',
              attemptNumber: 2,
              status: 'completed',
              output: 'Older result',
              error: null,
              durationMs: 4100,
              startedAt: '2025-01-01T00:00:00.000Z',
              completedAt: '2025-01-01T00:00:04.100Z',
              components: [],
              toolTrace: [],
              llmPromptTrace: [],
              inputTokens: 12,
              outputTokens: 24,
              totalTokens: 36,
              modelName: 'model-a',
              artifacts: [],
            },
          ],
        }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [baseStep],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: 1000,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:01.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        }}
      />,
    );

    expect(screen.getByText('detail.results.stepExecutionLabel')).toBeInTheDocument();
  });

  it('renders applied optimization diffs for advisor autopilot turns', async () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          advisorOptimizationHistory: [
            {
              turn: 1,
              createdAt: '2025-01-01T00:00:02.000Z',
              changedFields: ['description', 'allowClarification'],
              beforeTask: { description: 'Old prompt', allowClarification: false },
              afterTask: { description: 'New prompt', allowClarification: true },
            },
          ],
        }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          advisorAutopilotEnabled: true,
          taskResults: [baseStep],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: 1000,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:01.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        }}
      />,
    );

    expect(screen.getByText('detail.autopilot.appliedOptimizations')).toBeInTheDocument();
    await userEvent.click(screen.getByText('detail.autopilot.appliedOptimizations'));
    expect(screen.getByText('detail.autopilot.field.description')).toBeInTheDocument();
    expect(screen.getByText('Old prompt')).toBeInTheDocument();
    expect(screen.getByText('New prompt')).toBeInTheDocument();
  });

  it('prefers the live current attempt over persisted history for the same attempt number', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          status: 'running',
          attemptNumber: 3,
          output: 'Streaming output',
          completedAt: null,
          durationMs: null,
          stepExecutions: [
            {
              id: 'step-exec-3',
              attemptNumber: 3,
              status: 'completed',
              output: 'Persisted final snapshot',
              error: null,
              durationMs: 4100,
              startedAt: '2025-01-01T00:00:00.000Z',
              completedAt: '2025-01-01T00:00:04.100Z',
              components: [],
              toolTrace: [],
              llmPromptTrace: [],
              inputTokens: 12,
              outputTokens: 24,
              totalTokens: 36,
              modelName: 'model-a',
              artifacts: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Streaming output')).toBeInTheDocument();
    expect(screen.queryByText('Persisted final snapshot')).not.toBeInTheDocument();
    expect(screen.getByText('execution.running')).toBeInTheDocument();
  });

  it('clears a stale completed result when the step goes back to running', () => {
    const { rerender } = render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          status: 'completed',
          attemptNumber: 3,
          output: 'Persisted final snapshot',
          completedAt: '2025-01-01T00:00:04.100Z',
          stepExecutions: [
            {
              id: 'step-exec-3',
              attemptNumber: 3,
              status: 'completed',
              output: 'Persisted final snapshot',
              error: null,
              durationMs: 4100,
              startedAt: '2025-01-01T00:00:00.000Z',
              completedAt: '2025-01-01T00:00:04.100Z',
              components: [],
              toolTrace: [],
              llmPromptTrace: [],
              inputTokens: 12,
              outputTokens: 24,
              totalTokens: 36,
              modelName: 'model-a',
              artifacts: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Persisted final snapshot')).toBeInTheDocument();

    rerender(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          status: 'running',
          attemptNumber: 3,
          output: null,
          completedAt: null,
          durationMs: null,
          stepExecutions: [
            {
              id: 'step-exec-3',
              attemptNumber: 3,
              status: 'completed',
              output: 'Persisted final snapshot',
              error: null,
              durationMs: 4100,
              startedAt: '2025-01-01T00:00:00.000Z',
              completedAt: '2025-01-01T00:00:04.100Z',
              components: [],
              toolTrace: [],
              llmPromptTrace: [],
              inputTokens: 12,
              outputTokens: 24,
              totalTokens: 36,
              modelName: 'model-a',
              artifacts: [],
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText('Persisted final snapshot')).not.toBeInTheDocument();
    expect(screen.getByText('execution.running')).toBeInTheDocument();
  });

  it('renders plain text output when no components', () => {
    render(<ExecutionStepDetail step={baseStep} />);
    expect(screen.getByText('Result text here')).toBeInTheDocument();
  });

  it('renders error section for failed steps', () => {
    const failed: TaskResult = { ...baseStep, status: 'failed', error: 'OOM killed', output: null };
    render(<ExecutionStepDetail step={failed} />);
    expect(screen.getByText('OOM killed')).toBeInTheDocument();
    expect(screen.getByText('execution.error')).toBeInTheDocument();
  });

  it('renders running indicator for running steps', () => {
    const running: TaskResult = { ...baseStep, status: 'running', output: null, completedAt: null, durationMs: null };
    render(<ExecutionStepDetail step={running} />);
    expect(screen.getByText('execution.running')).toBeInTheDocument();
  });

  it('renders components via AIMessageContent when present', () => {
    const withComponents: TaskResult = {
      ...baseStep,
      components: [{ type: 'text', data: { text: 'hello' } }],
    };
    render(<ExecutionStepDetail step={withComponents} />);
    expect(screen.getByTestId('ai-content')).toBeInTheDocument();
  });

  it('renders tool trace when present', async () => {
    const withTrace: TaskResult = {
      ...baseStep,
      toolTrace: [
        {
          callIndex: 1,
          toolName: 'perform_document_search',
          args: { query: 'operational risk' },
          outputSummary: 'top hits',
        },
      ],
    };
    render(<ExecutionStepDetail step={withTrace} />);
    await userEvent.click(screen.getByText('detail.tabs.traces'));
    await userEvent.click(screen.getByText('detail.tabs.toolTrace'));
    expect(screen.getByText('perform_document_search')).toBeInTheDocument();
    expect(screen.getByText('top hits')).toBeInTheDocument();
  });

  it('renders semantic match including evidence consistency in evaluation tab', () => {
    const withSemanticMatch: TaskResult = {
      ...baseStep,
      semanticMatch: {
        matchScore: 91,
        semanticSimilarityScore: 88,
        evidenceConsistencyScore: 93,
        judgeScore: 90,
        reason: 'Outputs align with the validated baseline.',
        missingPoints: [],
        changedPoints: ['Minor wording updates'],
        model: 'test-evaluation-model',
        judgeUsed: true,
      },
    };

    render(<ExecutionStepDetail step={withSemanticMatch} />);
    expect(screen.queryByText('detail.evaluation.description')).not.toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.semanticMatch')).toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.evidenceConsistency')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('Minor wording updates')).toBeInTheDocument();
  });

  it('renders replay provenance when execution is replayed', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'replay_strict',
      replaySourceByTask: { t1: { replayId: 'r1', validationVersion: 3 } },
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(<ExecutionStepDetail step={baseStep} execution={execution} />);
    expect(screen.getByText('detail.provenance.title')).toBeInTheDocument();
    expect(screen.getByText('detail.provenance.baseline: v3')).toBeInTheDocument();
  });

  it('runs evaluation manually from the evaluation pane', async () => {
    const onRequestRunAdvisorEvaluation = vi.fn();
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
        <ExecutionStepDetail
          step={baseStep}
          execution={execution}
          onRequestRunAdvisorEvaluation={onRequestRunAdvisorEvaluation}
        />,
      );

    await userEvent.click(screen.getByText('detail.tabs.evaluation'));
    await userEvent.click(screen.getAllByText('detail.actions.runAdvisorEvaluation')[0]);
    expect(onRequestRunAdvisorEvaluation).toHaveBeenCalledWith('t1');
  });

  it('runs advisor evaluation from the advisor pane CTA', async () => {
    const onRequestRunAdvisorEvaluation = vi.fn();
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={baseStep}
        execution={execution}
        onRequestRunAdvisorEvaluation={onRequestRunAdvisorEvaluation}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    await userEvent.click(screen.getAllByText('detail.actions.runAdvisorEvaluation')[0]);
    expect(onRequestRunAdvisorEvaluation).toHaveBeenCalledWith('t1');
  });

  it('renders persisted evaluation history metadata', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          semanticMatch: {
            matchScore: 91,
            semanticSimilarityScore: 88,
            evidenceConsistencyScore: 93,
            judgeScore: 90,
            reason: 'Outputs align with the validated baseline.',
            missingPoints: [],
            changedPoints: [],
            model: 'test-evaluation-model',
            judgeUsed: true,
          },
          evaluationHistory: [{
            id: 'hist-1',
            createdAt: '2025-01-01T00:01:00.000Z',
            attemptNumber: 2,
            trigger: 'manual',
            baselineReplayId: 'r1',
            baselineValidationVersion: 3,
            semanticMatch: {
              matchScore: 91,
              semanticSimilarityScore: 88,
              evidenceConsistencyScore: 93,
              judgeScore: 90,
              reason: 'Outputs align with the validated baseline.',
              missingPoints: [],
              changedPoints: [],
              model: 'test-evaluation-model',
              judgeUsed: true,
            },
          }],
        }}
        execution={execution}
      />,
    );

    expect(screen.getByText('detail.evaluation.stepExecutionLabel')).toBeInTheDocument();
    expect(screen.getByText(/detail.evaluation.trigger: manual/)).toBeInTheDocument();
    expect(screen.getByText(/detail.provenance.baseline: v3/)).toBeInTheDocument();
  });

  it('renders a step execution comparison when multiple evaluation history entries exist', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          semanticMatch: {
            matchScore: 91,
            semanticSimilarityScore: 88,
            evidenceConsistencyScore: 93,
            judgeScore: 90,
            reason: 'Selected attempt.',
            missingPoints: [],
            changedPoints: [],
            model: 'test-evaluation-model',
            judgeUsed: true,
          },
          evaluationHistory: [
            {
              id: 'hist-1',
              createdAt: '2025-01-01T00:01:00.000Z',
              attemptNumber: 2,
              trigger: 'manual',
              baselineReplayId: 'r1',
              baselineValidationVersion: 3,
              semanticMatch: {
                matchScore: 91,
                semanticSimilarityScore: 88,
                evidenceConsistencyScore: 93,
                judgeScore: 90,
                reason: 'Selected attempt.',
                missingPoints: [],
                changedPoints: [],
                model: 'test-evaluation-model',
                judgeUsed: true,
              },
            },
            {
              id: 'hist-2',
              createdAt: '2025-01-01T00:02:00.000Z',
              attemptNumber: 3,
              trigger: 'manual',
              baselineReplayId: 'r2',
              baselineValidationVersion: 4,
              semanticMatch: {
                matchScore: 84,
                semanticSimilarityScore: 80,
                evidenceConsistencyScore: 82,
                judgeScore: 86,
                reason: 'Compared attempt.',
                missingPoints: ['One item'],
                changedPoints: ['Another item'],
                model: 'test-evaluation-model',
                judgeUsed: true,
              },
            },
          ],
        }}
        execution={execution}
      />,
    );

    expect(screen.getByText('detail.evaluation.stepExecutionLabel')).toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.compareWith')).toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.compareTitle')).toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.comparedExecution')).toBeInTheDocument();
  });

  it('renders a selector for persisted advisor evaluations', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: null,
          judgeHistory: [
            {
              id: 'judge-1',
              createdAt: '2025-01-01T00:01:00.000Z',
              attemptNumber: 1,
              model: 'advisor-model-v1',
              judgeResult: {
                accuracyScore: 70,
                completenessScore: 72,
                overallScore: 71,
                confidence: 0.7,
                toolUsageScore: 68,
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
                toolUsageRecommendation: 'Use the validated source first.',
                safeAutoFixType: 'none',
                recommendation: 'none',
                reason: 'Earlier advisor result.',
              },
            },
            {
              id: 'judge-2',
              createdAt: '2025-01-01T00:02:00.000Z',
              attemptNumber: 2,
              model: 'advisor-model-v2',
              judgeResult: {
                accuracyScore: 81,
                completenessScore: 83,
                overallScore: 82,
                confidence: 0.8,
                toolUsageScore: 75,
                missingFacts: ['Missing control check'],
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
                toolUsageRecommendation: 'Earlier advisor result.',
                safeAutoFixType: 'none',
                recommendation: 'none',
                reason: 'Latest advisor result.',
              },
            },
          ],
        }}
        execution={execution}
      />,
    );

    expect(screen.getByText('detail.judge.stepExecutionLabel')).toBeInTheDocument();
    expect(screen.getByText(/detail.evaluation.attempt: 2/)).toBeInTheDocument();
    expect(screen.getByText(/detail.evaluation.judgeModel/)).toBeInTheDocument();
    expect(screen.getByText('Latest advisor result.')).toBeInTheDocument();
  });

  it('shows an in-progress message while evaluation is running', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'running',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={{ ...baseStep, status: 'running', output: null, completedAt: null, durationMs: null }}
        execution={execution}
        isRunningEvaluation={true}
      />,
    );

    expect(screen.getByText('detail.evaluation.inProgress')).toBeInTheDocument();
    expect(screen.getByText('detail.evaluation.runningMessage')).toBeInTheDocument();
  });

  it('prefers evaluation history data when semantic match is not on the root task result', () => {
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [baseStep],
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: 5200,
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:05.200Z',
      singleStepTaskId: null,
      playbookSnapshot: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          semanticMatch: null,
          evaluationHistory: [{
            id: 'hist-1',
            createdAt: '2025-01-01T00:01:00.000Z',
            attemptNumber: 2,
            trigger: 'manual',
            baselineReplayId: 'r1',
            baselineValidationVersion: 3,
            semanticMatch: {
              matchScore: 91,
              semanticSimilarityScore: 88,
              evidenceConsistencyScore: 93,
              judgeScore: 90,
              reason: 'Earlier history-only evaluation payload.',
              missingPoints: ['One item'],
              changedPoints: ['One changed item'],
              model: 'test-evaluation-model',
              judgeUsed: true,
            },
          }, {
            id: 'hist-2',
            createdAt: '2025-01-01T00:02:00.000Z',
            attemptNumber: 3,
            trigger: 'manual',
            baselineReplayId: 'r2',
            baselineValidationVersion: 4,
            semanticMatch: {
              matchScore: 84,
              semanticSimilarityScore: 80,
              evidenceConsistencyScore: 82,
              judgeScore: 86,
              reason: 'History-only evaluation payload.',
              missingPoints: ['One item'],
              changedPoints: [],
              model: 'test-evaluation-model',
              judgeUsed: true,
            },
          }],
        }}
        execution={execution}
      />,
    );

    expect(screen.getByText('History-only evaluation payload.')).toBeInTheDocument();
    expect(screen.getByText('84%')).toBeInTheDocument();
  });
});
