import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
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
  designPlaybook: vi.fn().mockResolvedValue(undefined),
  executePlaybook: vi.fn().mockResolvedValue({ executionId: 'exec-new' }),
  validateTaskReplay: vi.fn(),
  fetchTaskReplays: vi.fn().mockResolvedValue([]),
  traceReplayExecution: vi.fn().mockResolvedValue([]),
  reExecuteExecution: vi.fn().mockResolvedValue({ executionId: 'exec-new' }),
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

vi.mock('@/modules/conversation/utils', () => ({
  mapComponentsToContentParts: (items: any[]) => items.map((item) => {
    if (item?.type === 'text') {
      return {
        type: 'text',
        content: item?.data?.content ?? item?.data?.text ?? '',
      };
    }
    return item;
  }),
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
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

  it('renders iterator iteration results when present', async () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: null,
          iteratorIterations: [
            {
              index: 0,
              status: 'completed',
              itemPreview: '{"company":"ACME"}',
              output: 'Iteration output',
              childResults: [
                {
                  taskId: 'child-1',
                  taskTitle: 'Fetch account',
                  status: 'completed',
                  output: 'Child output',
                  components: [],
                  toolTrace: [],
                  llmPromptTrace: [],
                  artifacts: [],
                },
              ],
              artifacts: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/Fetch account/)).toBeInTheDocument();
    expect(screen.getByText(/Child output/)).toBeInTheDocument();
  });

  it('updates the step replay mode selector when the selected task mode changes', () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', stepReplayMode: 'live' }],
    };

    const { rerender } = render(
      <ExecutionStepDetail
        step={baseStep}
      />,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('execution.mode.live');

    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', stepReplayMode: 'replay_strict' }],
    };

    rerender(
      <ExecutionStepDetail
        step={baseStep}
      />,
    );

    expect(trigger).toHaveTextContent('execution.mode.replayStrict');

    storeState.currentPlaybook = null;
  });

  it('prefers the live playbook task replay mode over the stale execution snapshot', () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', stepReplayMode: 'replay_flex' }],
    };

    render(
      <ExecutionStepDetail
        step={baseStep}
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
          playbookSnapshot: { tasks: [{ id: 't1', stepReplayMode: 'live' }] },
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        }}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('execution.mode.replayFlex');

    storeState.currentPlaybook = null;
  });

  it('opens the remediation review dialog before generating a new optimized playbook', async () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', title: 'Analyze Data' }],
    };
    storeState.fetchAdvisorRemediations.mockResolvedValueOnce([
      {
        id: 'summary.highImpactRecommendations:playbook:0',
        category: 'structure',
        scope: 'playbook',
        targetTaskId: null,
        title: 'Split analysis step',
        description: 'Split the overloaded analysis step into two steps.',
        editable: true,
        defaultSelected: true,
        source: { kind: 'summary.highImpactRecommendations', field: 'summary.highImpactRecommendations', index: 0 },
      },
    ]);

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: {
            accuracyScore: 80,
            completenessScore: 90,
            resultMatchingScore: 92,
            overallScore: 85,
            confidence: 0.84,
            toolUsageScore: 78,
            expectedResultSource: 'node_field',
            expectedResultType: 'document_generation',
            expectedResultMatched: true,
            expectedResultReason: 'The step generated the required document artifact.',
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
          taskResults: [{
            ...baseStep,
            judgeResult: {
              accuracyScore: 80,
              completenessScore: 90,
              resultMatchingScore: 92,
              overallScore: 85,
              confidence: 0.84,
              toolUsageScore: 78,
              expectedResultSource: 'node_field',
              expectedResultType: 'document_generation',
              expectedResultMatched: true,
              expectedResultReason: 'The step generated the required document artifact.',
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
            judgeStatus: 'evaluated',
          }],
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

    expect(storeState.fetchAdvisorRemediations).toHaveBeenCalledWith('p1', 'exec-1', undefined);
    expect(storeState.generatePlaybookFromJudge).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText('detail.remediation.generateNewTitle')).toBeInTheDocument();

    storeState.currentPlaybook = null;
  });

  it('warns when advisor evaluation is missing for some playbook tasks before generating', async () => {
    storeState.fetchAdvisorRemediations.mockClear();
    storeState.executePlaybook.mockClear();
    storeState.currentPlaybook = {
      id: 'p1',
      advisorAutopilotTargetScore: 92,
      advisorAutopilotMaxTurns: 5,
      tasks: [
        { id: 't1', title: 'Analyze Data' },
        { id: 't2', title: 'Summarize Findings' },
      ],
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: {
            accuracyScore: 80,
            completenessScore: 90,
            resultMatchingScore: 92,
            overallScore: 85,
            confidence: 0.84,
            toolUsageScore: 78,
            expectedResultSource: 'node_field',
            expectedResultType: 'document_generation',
            expectedResultMatched: true,
            expectedResultReason: 'The step generated the required document artifact.',
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
          taskResults: [
            { ...baseStep, taskId: 't1', judgeResult: { overallScore: 80 } as any },
            { ...baseStep, taskId: 't2', nodeTitle: 'Summarize Findings', judgeResult: null, judgeStatus: 'idle' },
          ],
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

    expect(storeState.fetchAdvisorRemediations).not.toHaveBeenCalled();
    expect(screen.getByText('detail.judge.missingEvaluationTitle')).toBeInTheDocument();
    expect(screen.getByText('Summarize Findings')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'detail.judge.missingEvaluationRunCta' }));

    expect(storeState.executePlaybook).toHaveBeenCalledWith('p1', expect.objectContaining({
      executionMode: 'live',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 92,
      advisorAutopilotMaxTurns: 5,
    }));

    storeState.currentPlaybook = null;
  });

  it('warns when a current playbook task is missing entirely from execution task results before generating', async () => {
    storeState.fetchAdvisorRemediations.mockClear();
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [
        { id: 't1', title: 'Analyze Data' },
        { id: 't2', title: 'Summarize Findings' },
      ],
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: {
            accuracyScore: 80,
            completenessScore: 90,
            resultMatchingScore: 92,
            overallScore: 85,
            confidence: 0.84,
            toolUsageScore: 78,
            expectedResultSource: 'node_field',
            expectedResultType: 'document_generation',
            expectedResultMatched: true,
            expectedResultReason: 'The step generated the required document artifact.',
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
          taskResults: [
            { ...baseStep, taskId: 't1', judgeResult: { overallScore: 80 } as any, judgeStatus: 'evaluated' },
          ],
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

    expect(storeState.fetchAdvisorRemediations).not.toHaveBeenCalled();
    expect(screen.getByText('detail.judge.missingEvaluationTitle')).toBeInTheDocument();
    expect(screen.getByText('Summarize Findings')).toBeInTheDocument();

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
    expect(screen.getByTestId('step-result-markdown')).toBeInTheDocument();
  });

  it('renders markdown fallback output via shared message renderer', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: '| Product |\n|---|\n| Product A |\n| Product B |',
        }}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Product A')).toBeInTheDocument();
  });

  it('preserves plain-text line breaks in fallback output styling', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: 'Line one\nLine two',
        }}
      />,
    );

    expect(screen.getByTestId('step-result-markdown')).toHaveClass('[&_p]:whitespace-pre-wrap');
  });

  it('prefers displayText over raw output json', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: '{"display_text":"Raw json fallback"}',
          displayText: 'Readable answer',
        }}
      />,
    );

    expect(screen.getByText('Readable answer')).toBeInTheDocument();
    expect(screen.queryByText('{"display_text":"Raw json fallback"}')).not.toBeInTheDocument();
  });

  it('renders selected execution artifacts from history', async () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          attemptNumber: 2,
          artifacts: [{
            portId: 'report',
            artifactKind: 'document',
            filename: 'latest-report.pdf',
            url: 'https://example.com/latest-report.pdf',
          }],
          stepExecutions: [
            {
              id: 'older-exec',
              attemptNumber: 1,
              status: 'completed',
              output: 'Older result',
              displayText: 'Older result',
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
              artifacts: [{
                portId: 'report',
                artifactKind: 'document',
                filename: 'older-report.pdf',
                url: 'https://example.com/older-report.pdf',
              }],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('report')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /report/ }));
    expect(screen.getByText('latest-report.pdf')).toBeInTheDocument();
    // Switch to older attempt
    await userEvent.click(screen.getByRole('button', { name: /detail.evaluation.attempt 2/i }));
    await userEvent.click(screen.getByText(/detail.evaluation.attempt 1 \|/i));
    // Verify older attempt's port pane is present
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('report')).toBeInTheDocument();
    expect(screen.queryByText('latest-report.pdf')).not.toBeInTheDocument();
  });

  it('hides artifact download actions for unsafe urls', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          artifacts: [{
            portId: 'report',
            artifactKind: 'document',
            filename: 'report.pdf',
            url: 'javascript:alert(1)',
          }],
        }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'artifacts.download' })).not.toBeInTheDocument();
  });

  it('shows artifact download action for generated documents with safe urls', async () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          artifacts: [{
            portId: 'report',
            artifactKind: 'document',
            filename: 'report.pdf',
            url: 'https://example.com/report.pdf',
          }],
        }}
      />,
    );

    expect(screen.getByText('report')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /report/ }));
    expect(screen.getByRole('button', { name: 'artifacts.download' })).toBeInTheDocument();
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
    expect(screen.getByText('hello')).toBeInTheDocument();
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

  it('renders evaluation artifact fallback when semantic match history is absent', async () => {
    const withEvaluationArtifact: TaskResult = {
      ...baseStep,
      artifacts: [{
        portId: 'evaluation',
        artifactKind: 'data',
        metadata: {
          data: {
            type: 'playbook_evaluation_result',
            score: 88,
            verdict: 'pass',
            summary: 'Evaluation succeeded.',
            semanticScore: 90,
            referenceScore: 80,
            findings: [{ category: 'semantic', severity: 'info', message: 'ok' }],
          },
        },
      } as any],
    };

    render(<ExecutionStepDetail step={withEvaluationArtifact} />);
    await userEvent.click(screen.getByText('detail.tabs.evaluation'));
    expect(screen.getByText('Evaluation succeeded.')).toBeInTheDocument();
    expect(screen.getByText(/pass/i)).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
  });

  it('shows save evaluation baseline action for evaluation tasks', async () => {
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
      playbookSnapshot: { tasks: [{ id: 't1', taskType: 'evaluation' }], edges: [] } as any,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.200Z',
    };

    render(<ExecutionStepDetail step={baseStep} execution={execution} />);
    await userEvent.click(screen.getByText('detail.tabs.evaluation'));
    expect(screen.getByText('detail.actions.saveEvaluationBaseline')).toBeInTheDocument();
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

  it('runs replay evaluation manually from the evaluation pane', async () => {
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

    await userEvent.click(screen.getByText('detail.tabs.evaluation'));
    await userEvent.click(screen.getByText('detail.actions.runReplayEvaluation'));
    expect(onRequestRunEvaluation).toHaveBeenCalledWith('t1');
  });

  it('runs advisor evaluation from the advisor pane CTA', async () => {
    const onRequestRunAdvisorEvaluation = vi.fn();
    const step = { ...baseStep, iteration: 2 };
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'completed',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [step],
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
        step={step}
        execution={execution}
        onRequestRunAdvisorEvaluation={onRequestRunAdvisorEvaluation}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    await userEvent.click(screen.getAllByText('detail.actions.runAdvisorEvaluation')[0]);
    expect(onRequestRunAdvisorEvaluation).toHaveBeenCalledWith('t1', 2);
  });

  it('disables advisor evaluation until the selected step is completed', async () => {
    const onRequestRunAdvisorEvaluation = vi.fn();
    const step = { ...baseStep, status: 'running' as const };
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 2,
      status: 'running',
      executionMode: 'live',
      replaySourceByTask: null,
      taskResults: [step],
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
        step={step}
        execution={execution}
        onRequestRunAdvisorEvaluation={onRequestRunAdvisorEvaluation}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    expect(screen.getAllByText('detail.actions.runAdvisorEvaluation')[0]).toBeDisabled();
    expect(onRequestRunAdvisorEvaluation).not.toHaveBeenCalled();
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
              scoringMode: 'llm' as const,
              judgeResult: {
                accuracyScore: 70,
                completenessScore: 72,
                resultMatchingScore: 68,
                overallScore: 71,
                confidence: 0.7,
                toolUsageScore: 68,
                expectedResultSource: 'golden_baseline',
                expectedResultType: 'baseline_comparison',
                expectedResultMatched: false,
                expectedResultReason: 'The result partially diverged from the baseline output.',
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
              scoringMode: 'heuristic' as const,
              judgeResult: {
                accuracyScore: 81,
                completenessScore: 83,
                resultMatchingScore: 88,
                overallScore: 82,
                confidence: 0.8,
                toolUsageScore: 75,
                expectedResultSource: 'node_field',
                expectedResultType: 'semantic_description',
                expectedResultMatched: true,
                expectedResultReason: 'The latest result satisfied the step expectation semantically.',
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

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText(/detail.evaluation.attempt - \| 01\/01\/2025 01:00:05/)).toBeInTheDocument();
    expect(screen.getAllByText('Latest advisor result.').length).toBeGreaterThan(0);
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

  it('calls traceReplayExecution when trace-replay button is clicked', async () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{
        id: 't1',
        hasValidatedReplay: true,
        activeReplayVersion: 3,
      }],
    };
    const execution: PlaybookExecution = {
      id: 'e1',
      playbookId: 'p1',
      executedBy: 'u1',
      executionNumber: 1,
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

    render(<ExecutionStepDetail step={baseStep} execution={execution} />);

    await userEvent.click(screen.getByRole('button', { name: 'detail.actions.traceReplay' }));
    expect(storeState.traceReplayExecution).toHaveBeenCalledWith('e1');

    storeState.currentPlaybook = null;
  });

});
