import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionStepDetail } from './ExecutionStepDetail';
import type { PlaybookExecution, TaskResult } from '../types';

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
  usePlaybookStore: (selector: any) => selector({
    currentPlaybook: null,
    deleteExecution: vi.fn(),
    validateTaskReplay: vi.fn(),
    fetchTaskReplays: vi.fn().mockResolvedValue([]),
  }),
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
  it('shows placeholder when no step is selected', () => {
    render(<ExecutionStepDetail step={null} />);
    expect(screen.getByText('execution.selectStep')).toBeInTheDocument();
  });

  it('renders step title and status badge', () => {
    render(<ExecutionStepDetail step={baseStep} />);
    expect(screen.getByText('Analyze Data')).toBeInTheDocument();
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

  it('renders tool trace when present', () => {
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
    expect(screen.getByText('Tool Trace')).toBeInTheDocument();
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
    expect(screen.getByText('Semantic Match')).toBeInTheDocument();
    expect(screen.getByText('Evidence Consistency')).toBeInTheDocument();
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
    expect(screen.getByText('Replay Provenance')).toBeInTheDocument();
    expect(screen.getByText('Validated baseline: v3')).toBeInTheDocument();
  });

  it('runs evaluation manually from the evaluation pane', async () => {
    const onRequestRunEvaluation = vi.fn();
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
        onRequestRunEvaluation={onRequestRunEvaluation}
      />,
    );

    screen.getByText('Run Evaluation').click();
    expect(onRequestRunEvaluation).toHaveBeenCalledWith('t1');
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

    expect(screen.getByText('Evaluation Run')).toBeInTheDocument();
    expect(screen.getByText(/Trigger: manual/)).toBeInTheDocument();
    expect(screen.getByText(/Baseline: v3/)).toBeInTheDocument();
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

    expect(screen.getByText('Evaluation in progress')).toBeInTheDocument();
    expect(screen.getByText('Waiting for evaluation results...')).toBeInTheDocument();
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
