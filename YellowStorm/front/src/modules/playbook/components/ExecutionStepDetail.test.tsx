import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionStepDetail } from './ExecutionStepDetail';
import type { PlaybookExecution, TaskResult } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());
const replayReportsApi = vi.hoisted(() => ({
  getReplayReports: vi.fn().mockResolvedValue([]),
}));
const mapComponentsToContentPartsMock = vi.hoisted(() => vi.fn((items: any[]) => items.map((item) => {
  if (item?.type === 'text') {
    return {
      type: 'text',
      content: item?.data?.content ?? item?.data?.text ?? '',
    };
  }
  if (item?.type === 'artifact') {
    return {
      type: 'artifact',
      filePath: item?.data?.filePath ?? item?.data?.file_path ?? '',
      filename: item?.data?.filename ?? '',
    };
  }
  return item;
})));
const storeState = vi.hoisted(() => ({
  currentPlaybook: null as any,
  deleteExecution: vi.fn(),
  deleteStepExecution: vi.fn(),
  fetchAdvisorRemediations: vi.fn().mockResolvedValue([]),
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
  useModuleTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'detail.tabs.evaluation': 'Reference Check',
        'replayReport.title': 'Reference Check',
        'replayReport.postRun.detailsTitle': 'Advanced diagnostics',
        'replayReport.advancedHint': 'Open technical scores and raw judge output.',
        'replayReport.section.verdict': 'Replay verdict',
        'replayReport.section.eligibility': 'Eligibility',
        'replayReport.section.semantic': 'Semantic match',
        'replayReport.section.structuralTooling': 'Structural & tooling',
        'replayReport.verdictReasons': 'Verdict reasons',
        'replayReport.verdictReason.structuralDriftDetected': 'Structural drift was detected.',
        'replayReport.modeValue.replay_strict': 'Replay (Strict)',
        'replayReport.reason.mismatch': '{{subject}} changed.',
        'replayReport.reason.missingRequiredSection': 'Missing required section: {{section}}.',
        'replayReport.reason.missingRequiredKey': 'Missing required key: {{field}}.',
        'replayReport.reason.jsonObjectRequired': 'The replay output must be a JSON object.',
        'replayReport.reasonSubject.nodeSnapshot': 'node snapshot',
      };
      const template = translations[key];
      if (!template) {
        return key;
      }
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

vi.mock('../api', () => replayReportsApi);

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span data-testid="badge">{status}</span>,
}));

vi.mock('@/modules/conversation/utils', () => ({
  mapComponentsToContentParts: mapComponentsToContentPartsMock,
}));

vi.mock('@/components/ui/tabs', () => {
  const React = require('react') as typeof import('react');
  const TabsContext = React.createContext<{
    activeValue: string;
    setActiveValue: (value: string) => void;
  } | null>(null);

  return {
    Tabs: ({ children, defaultValue, value, onValueChange }: any) => {
      const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue || '');
      const isControlled = value !== undefined;
      const activeValue = isControlled ? value : uncontrolledValue;
      const setActiveValue = (next: string) => {
        onValueChange?.(next);
        if (!isControlled) {
          setUncontrolledValue(next);
        }
      };
      return (
        <TabsContext.Provider value={{ activeValue, setActiveValue }}>
          <div>{children}</div>
        </TabsContext.Provider>
      );
    },
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: any) => {
      const context = React.useContext(TabsContext);
      return <button type="button" onClick={() => context?.setActiveValue(value)}>{children}</button>;
    },
    TabsContent: ({ children, value }: any) => {
      const context = React.useContext(TabsContext);
      return context?.activeValue === value ? <div>{children}</div> : null;
    },
  };
});

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
  beforeEach(() => {
    storeState.currentPlaybook = null;
    storeState.deleteExecution.mockReset();
    storeState.deleteStepExecution.mockReset();
    storeState.fetchAdvisorRemediations.mockReset().mockResolvedValue([]);
    storeState.executePlaybook.mockReset().mockResolvedValue({ executionId: 'exec-new' });
    storeState.validateTaskReplay.mockReset();
    storeState.fetchTaskReplays.mockReset().mockResolvedValue([]);
    storeState.traceReplayExecution.mockReset().mockResolvedValue([]);
    storeState.reExecuteExecution.mockReset().mockResolvedValue({ executionId: 'exec-new' });
    navigateMock.mockReset();
    replayReportsApi.getReplayReports.mockReset().mockResolvedValue([]);
    mapComponentsToContentPartsMock.mockClear();
  });

  it('shows generated artifact view and download actions in the result card', () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{
        id: 't1',
        title: 'Analyze Data',
        outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'document' }],
      }],
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: 'PDF generated successfully',
          components: [{
            type: 'artifact',
            data: {
              filePath: 'generated/intelligence_artificielle.pdf',
              filename: 'intelligence_artificielle.pdf',
            },
          } as any],
        }}
      />,
    );

    expect(screen.getByText('intelligence_artificielle.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actionView' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actionDownload' })).toBeInTheDocument();

    storeState.currentPlaybook = null;
  });

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

  it('renders persisted HITL feedback for the selected node result', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          hitlHistory: [{
            interruptId: 'interrupt-1',
            taskId: 't1',
            type: 'clarification',
            taskTitle: 'Analyze Data',
            message: 'Which region should I search?',
            taskDescription: '',
            result: '',
            round: 0,
            payloadJson: '',
            resumableActions: [],
            status: 'answered',
            responseAction: 'reply',
            responseMessage: 'France',
            responseApproved: null,
            responseReason: null,
            responseFeedback: null,
            respondedBy: null,
            respondedAt: '2026-06-02T08:47:00.000Z',
            createdAt: '2026-06-02T08:46:00.000Z',
          }],
        }}
      />,
    );

    expect(screen.getByText('detail.hitlFeedback.title')).toBeInTheDocument();
    expect(screen.getByText('Which region should I search?')).toBeInTheDocument();
    expect(screen.getByText('France')).toBeInTheDocument();
  });

  it('renders replay flex planning details when available on the execution', () => {
    render(
      <ExecutionStepDetail
        step={baseStep}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          executionMode: 'replay_flex',
          replaySourceByTask: { t1: { replayId: 'r1', validationVersion: 3 } },
          replayPlanningByTask: {
            t1: {
              replayId: 'r1',
              validationVersion: 3,
              intentKey: 'earnings.summary',
              intentLabel: 'Summarize earnings changes',
              contextMapping: [
                {
                  variableKey: 'ticker',
                  key: 'ticker',
                  label: 'Ticker',
                  source: 'input_context',
                  valueType: 'string',
                  required: true,
                  baselineValue: 'AAPL',
                  currentValue: 'MSFT',
                  confidence: 1,
                  reason: 'matched_input_context',
                  value: 'MSFT',
                  matched: true,
                },
              ],
              executionPlan: {
                taskId: 't1',
                replayId: 'r1',
                validationVersion: 3,
                intentKey: 'earnings.summary',
                intentLabel: 'Summarize earnings changes',
                matchedContextCount: 1,
                missingRequiredContextCount: 0,
                requiredStageLabels: ['Extract data'],
                requiredOutputChecks: ['Include section: Summary'],
                plannedToolSteps: [
                  {
                    stepIndex: 1,
                    toolName: 'search_financials',
                    purpose: 'load earnings',
                    required: true,
                    argumentShape: { ticker: 'string' },
                    argumentShapeKeys: ['ticker'],
                    expectedArgs: { ticker: 'MSFT' },
                    sourceCallIndex: 1,
                  },
                ],
                semanticChecklist: [],
              },
            },
          },
          taskResults: [baseStep],
          threadId: null,
          interruptPayload: null,
          waitingForHumanInput: false,
          currentInterruptId: null,
          currentInterruptTaskId: null,
          hitlHistory: [],
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:05.200Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('replayPlanning.contextTitle')).toBeInTheDocument();
    expect(screen.getByText('Ticker')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('replayPlanning.planTitle')).toBeInTheDocument();
    expect(screen.getByText('1. search_financials')).toBeInTheDocument();
  });

  it('shows an unresolved required replay context warning before the replay plan details', () => {
    render(
      <ExecutionStepDetail
        step={baseStep}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          executionMode: 'replay_flex',
          replaySourceByTask: { t1: { replayId: 'r1', validationVersion: 3 } },
          replayPlanningByTask: {
            t1: {
              replayId: 'r1',
              validationVersion: 3,
              intentKey: 'earnings.summary',
              intentLabel: 'Summarize earnings changes',
              contextMapping: [
                {
                  variableKey: 'region',
                  key: 'region',
                  label: 'Region',
                  source: 'input_context',
                  valueType: 'string',
                  required: true,
                  baselineValue: 'EMEA',
                  currentValue: null,
                  confidence: 0,
                  reason: 'deterministic_mapping_not_found',
                  value: null,
                  matched: false,
                },
              ],
              executionPlan: {
                taskId: 't1',
                replayId: 'r1',
                validationVersion: 3,
                intentKey: 'earnings.summary',
                intentLabel: 'Summarize earnings changes',
                matchedContextCount: 0,
                missingRequiredContextCount: 1,
                requiredStageLabels: [],
                requiredOutputChecks: [],
                plannedToolSteps: [],
                semanticChecklist: [],
              },
            },
          },
          taskResults: [baseStep],
          threadId: null,
          interruptPayload: null,
          waitingForHumanInput: false,
          currentInterruptId: null,
          currentInterruptTaskId: null,
          hitlHistory: [],
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:05.200Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('replayPlanning.unresolvedRequiredWarning')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('replayPlanning.unresolved')).toBeInTheDocument();
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

  it('summarizes python-style iterator payload output instead of showing the raw dump', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: null,
          iteratorIterations: [
            {
              index: 0,
              status: 'completed',
              itemPreview: 'product a',
              output: "{('cbd665d0-e3b7-4bac-bb1b-4393de74e116', 0): {'output': '2', 'display_text': '2', 'artifacts': [{'port_id': 'default', 'artifact_kind': 'text', 'content': '2'}], 'components': [], 'outputs': {'default': {'output_port_id': 'default', 'artifact_kind': 'text', 'content': '2'}}, 'node_id': 'cbd665d0-e3b7-4bac-bb1b-4393de74e116', 'iteration': 0}}",
              childResults: [],
              artifacts: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/cbd665d0-e3b7-4bac-bb1b-4393de74e116/)).not.toBeInTheDocument();
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
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    await userEvent.click(screen.getByRole('button', { name: 'detail.judge.generateOptimizedPlaybook' }));

    expect(storeState.fetchAdvisorRemediations).toHaveBeenCalledWith('p1', 'exec-1', undefined);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText('detail.remediation.generateNewTitle')).toBeInTheDocument();

    storeState.currentPlaybook = null;
  });

  it('applies selected remediation items through the advisor intent callback', async () => {
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', title: 'Analyze Data' }],
    };
    storeState.fetchAdvisorRemediations.mockResolvedValueOnce([
      {
        id: 'rem-1',
        category: 'prompt',
        scope: 'task',
        targetTaskId: 't1',
        title: 'Clarify the task prompt',
        description: 'Clarify the task prompt to request a concise summary.',
        editable: true,
        defaultSelected: true,
        source: { kind: 'judge_result', field: 'prompt', index: 0 },
      },
    ]);

    render(
      <ExecutionStepDetail
        step={{ ...baseStep, judgeResult: { overallScore: 82 } as any, judgeStatus: 'evaluated' }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [{ ...baseStep, judgeResult: { overallScore: 82 } as any, judgeStatus: 'evaluated' }],
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    await userEvent.click(screen.getByRole('button', { name: 'detail.judge.previewChanges' }));
    await screen.findByText('detail.remediation.optimizeStepTitle');
    await userEvent.click(screen.getByRole('button', { name: 'detail.remediation.applySelected' }));

    expect(onApplyAdvisorIntent).toHaveBeenCalledWith({
      mode: 'optimize-step',
      executionId: 'exec-1',
      items: [
        {
          id: 'rem-1',
          category: 'prompt',
          description: 'Clarify the task prompt to request a concise summary.',
        },
      ],
      selectedTaskId: 't1',
    });

    storeState.currentPlaybook = null;
  });

  it('keeps optimize actions available despite high score, no recommendation, and empty rewrite hints', async () => {
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
    storeState.fetchAdvisorRemediations.mockClear();
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', title: 'Analyze Data' }],
    };

    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          judgeResult: {
            overallScore: 98,
            recommendation: 'none',
            safeAutoFixType: 'none',
            rewriteHints: [],
            reason: 'Looks good.',
          } as any,
          judgeStatus: 'evaluated',
        }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [{ ...baseStep, judgeResult: { overallScore: 98 } as any, judgeStatus: 'evaluated' }],
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    expect(screen.getByRole('button', { name: 'detail.judge.previewChanges' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'detail.judge.applyToCurrentPlaybook' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'detail.judge.generateOptimizedPlaybook' })).toBeEnabled();

    storeState.currentPlaybook = null;
  });

  it('allows optimize-step apply with no selected remediation items', async () => {
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
    storeState.fetchAdvisorRemediations.mockResolvedValueOnce([]);
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', title: 'Analyze Data' }],
    };

    render(
      <ExecutionStepDetail
        step={{ ...baseStep, judgeResult: { overallScore: 98, rewriteHints: [] } as any, judgeStatus: 'evaluated' }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [{ ...baseStep, judgeResult: { overallScore: 98, rewriteHints: [] } as any, judgeStatus: 'evaluated' }],
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    await userEvent.click(screen.getByRole('button', { name: 'detail.judge.previewChanges' }));
    await screen.findByText('detail.remediation.optimizeStepTitle');
    await userEvent.click(screen.getByRole('button', { name: 'detail.remediation.applySelected' }));

    expect(onApplyAdvisorIntent).toHaveBeenCalledWith({
      mode: 'optimize-step',
      executionId: 'exec-1',
      items: [],
      selectedTaskId: 't1',
    });

    storeState.currentPlaybook = null;
  });

  it('disables remediation apply actions when the canvas handler is unavailable', async () => {
    storeState.currentPlaybook = {
      id: 'p1',
      tasks: [{ id: 't1', title: 'Analyze Data' }],
    };

    render(
      <ExecutionStepDetail
        step={{ ...baseStep, judgeResult: { overallScore: 82, rewriteHints: [] } as any, judgeStatus: 'evaluated' }}
        execution={{
          id: 'exec-1',
          playbookId: 'p1',
          executedBy: 'user-1',
          executionNumber: 1,
          status: 'completed',
          taskResults: [{ ...baseStep, judgeResult: { overallScore: 82, rewriteHints: [] } as any, judgeStatus: 'evaluated' }],
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

    await userEvent.click(screen.getByText('detail.tabs.judge'));
    expect(screen.getByRole('button', { name: 'detail.judge.generateOptimizedPlaybook' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'detail.judge.previewChanges' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'detail.judge.applyToCurrentPlaybook' })).toBeDisabled();
    expect(screen.getByText('detail.remediation.applyUnavailable')).toBeInTheDocument();

    storeState.currentPlaybook = null;
  });

  it('warns when advisor evaluation is missing for some playbook tasks before generating', async () => {
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
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
    const onApplyAdvisorIntent = vi.fn().mockResolvedValue(undefined);
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
        onApplyAdvisorIntent={onApplyAdvisorIntent}
      />,
    );

    await userEvent.click(screen.getByText('detail.tabs.judge'));
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

    await userEvent.click(screen.getByText('detail.tabs.judge'));
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

  it('uses compact fallback output styling', () => {
    render(
      <ExecutionStepDetail
        step={{
          ...baseStep,
          output: 'Line one\nLine two',
        }}
      />,
    );

    expect(screen.getByTestId('step-result-markdown')).toHaveClass('[&_*]:!text-[14px]');
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

  it('passes result text and citations through the same message content mapping', () => {
    mapComponentsToContentPartsMock.mockClear();
    const withCitation: TaskResult = {
      ...baseStep,
      output: 'Priorite moyenne [2].',
      components: [{
        type: 'citation',
        data: {
          source: 'user-1/codeinterpreter/contract.docx',
          reference: '[2]',
        },
      }],
    };

    render(<ExecutionStepDetail step={withCitation} />);

    expect(mapComponentsToContentPartsMock).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: 'playbook-final-text-t1',
        type: 'text',
        data: { content: 'Priorite moyenne [2].' },
      }),
      expect.objectContaining({
        type: 'citation',
        data: expect.objectContaining({ reference: '[2]' }),
      }),
    ]));
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

  it('switches to traces content even when the caller does not update the active tab prop', async () => {
    const withPromptTrace: TaskResult = {
      ...baseStep,
      llmPromptTrace: [
        {
          stage: 'initial_request',
          model: 'gpt-5.4-mini',
          prompt: '## Validated Replay Baseline\n### Validated Tool Policy\n- Use tool: search',
          generatedOutput: 'LLM selected the search tool.',
        },
      ],
    };

    render(<ExecutionStepDetail step={withPromptTrace} activeTab="results" />);

    await userEvent.click(screen.getByText('detail.tabs.traces'));
    await userEvent.click(screen.getByText('detail.tabs.llmPrompts').closest('button')!);
    await userEvent.click(screen.getByText('1.').closest('button')!);

    expect(screen.getByText(/Use tool: search/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('detail.prompts.outputLabel'));
    expect(screen.getByText('LLM selected the search tool.')).toBeInTheDocument();
  });

  it('renders reasoning chain when present', async () => {
    const withReasoning: TaskResult = {
      ...baseStep,
      reasoningChain: [
        {
          id: 'r1',
          type: 'analysis',
          label: 'Risk Assessment',
          description: 'Evaluated operational risk factors based on document search results.',
          confidence: 0.87,
        },
        {
          id: 'r2',
          type: 'decision',
          label: 'Final Verdict',
          description: 'Determined the overall risk level is acceptable.',
          confidence: null,
        },
      ],
    };
    render(<ExecutionStepDetail step={withReasoning} />);
    await userEvent.click(screen.getByText('detail.tabs.traces'));
    await userEvent.click(screen.getByText('detail.reasoning.title'));
    expect(screen.getByText('Risk Assessment')).toBeInTheDocument();
    expect(screen.getByText('Evaluated operational risk factors based on document search results.')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('Final Verdict')).toBeInTheDocument();
    expect(screen.queryByText('detail.reasoning.empty')).not.toBeInTheDocument();
  });

  it('shows reasoning empty state when chain is absent', async () => {
    render(<ExecutionStepDetail step={baseStep} />);
    await userEvent.click(screen.getByText('detail.tabs.traces'));
    await userEvent.click(screen.getByText('detail.reasoning.title'));
    expect(screen.getByText('detail.reasoning.empty')).toBeInTheDocument();
  });

  it('renders semantic match including evidence consistency in evaluation tab', async () => {
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
    await userEvent.click(screen.getByText('Reference Check'));
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
    await userEvent.click(screen.getByText('Reference Check'));
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
    await userEvent.click(screen.getByRole('button', { name: 'Reference Check' }));
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

    await userEvent.click(screen.getByText('Reference Check'));
    await userEvent.click(screen.getByText('detail.actions.runReplayEvaluation'));
    expect(onRequestRunEvaluation).toHaveBeenCalledWith('t1');
  });

  it('renders replay report content in the replay evaluation tab', async () => {
    replayReportsApi.getReplayReports.mockResolvedValueOnce([{
      id: 'report-1',
      executionId: 'e1',
      flowId: 'p1',
      taskId: 't1',
      replayId: 'replay-1',
      validationVersion: 3,
      mode: 'replay_strict',
      applied: true,
      confidenceScore: 100,
      appliedSections: ['output_contract'],
      skippedSections: [],
      invalidationReasons: ['node_snapshot_mismatch'],
      confidenceFactors: { nodeSnapshotHash: 30 },
      outputContractEvaluated: true,
      outputContractPassed: true,
      structuralDriftScore: 100,
      toolPolicyScore: 100,
      verdict: 'warning',
      overallScore: 76,
      verdictReasons: ['structural_drift_detected'],
      structuralDriftReasons: ['missing_required_section:Summary'],
      semanticMatch: {
        matchScore: 91,
        semanticSimilarityScore: 90,
        evidenceConsistencyScore: 89,
        judgeScore: 93,
        reason: 'Replay output matches the captured intent',
        missingPoints: ['minor citation detail'],
        changedPoints: ['section phrasing'],
        model: 'judge-model',
        judgeUsed: true,
      },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:05.000Z',
    }]);

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

    render(<ExecutionStepDetail step={baseStep} execution={execution} activeTab="evaluation" />);

    expect((await screen.findAllByText('Reference Check')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Advanced diagnostics/i }));
    expect(screen.getByText('Replay verdict')).toBeInTheDocument();
    expect(screen.getByText('Eligibility')).toBeInTheDocument();
    expect(screen.getByText('Semantic match')).toBeInTheDocument();
    expect(screen.getByText('Structural & tooling')).toBeInTheDocument();
    expect(screen.getByText(/replayReport.verdict: replayReport.verdictValue.warning/)).toBeInTheDocument();
    expect(screen.getByText('replayReport.overallScore')).toBeInTheDocument();
    expect(screen.getAllByText('76%').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Structural drift was detected./).length).toBeGreaterThan(0);
    expect(screen.getByText(/Replay output matches the captured intent/)).toBeInTheDocument();
    expect(screen.getAllByText(/minor citation detail/).length).toBeGreaterThan(0);
    expect(document.body).toHaveTextContent('node snapshot changed.');
    expect(document.body).toHaveTextContent('Missing required section: Summary.');
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
        activeTab="evaluation"
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
        activeTab="evaluation"
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
        activeTab="judge"
      />,
    );

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText(/detail.evaluation.attempt - \| .*2025/)).toBeInTheDocument();
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
        activeTab="evaluation"
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
        activeTab="evaluation"
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
