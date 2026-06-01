import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookDesignerPanel } from './PlaybookDesignerPanel';
import type { HitlFeedbackScope, InterruptType, PlaybookExecution } from '../types';

type StoreSnapshot = {
  currentExecution: PlaybookExecution | null;
  copilotMode: 'design' | 'interrupt';
  designerOpen: boolean;
  resumeExecution: ReturnType<typeof vi.fn>;
  disableHitlBlocker: ReturnType<typeof vi.fn>;
  selectStep: ReturnType<typeof vi.fn>;
};

const storeState: StoreSnapshot = {
  currentExecution: null,
  copilotMode: 'interrupt',
  designerOpen: true,
  resumeExecution: vi.fn(),
  disableHitlBlocker: vi.fn(),
  selectStep: vi.fn(),
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, params?: { count?: number }) => (params?.count ? `${key}:${params.count}` : key) }),
}));

vi.mock('../hooks/useAutosave', () => ({
  useAutosave: () => ({ saveNow: vi.fn() }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => (
    <select aria-label="interrupt.scopeLabel" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="step_only">interrupt.scope.step_only</option>
      <option value="downstream_run">interrupt.scope.downstream_run</option>
      <option value="entire_run">interrupt.scope.entire_run</option>
      <option value="future_node_runs">interrupt.scope.future_node_runs</option>
      <option value="future_workflow_runs">interrupt.scope.future_workflow_runs</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      aria-label="interrupt.rememberFeedback"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    fetchDesignMessages: vi.fn(),
    designPlaybook: vi.fn(),
    revertToSnapshot: vi.fn(),
    resumeExecution: storeState.resumeExecution,
    disableHitlBlocker: storeState.disableHitlBlocker,
    setDesignerOpen: vi.fn(),
    setCopilotMode: vi.fn(),
    selectStep: storeState.selectStep,
    stopExecution: vi.fn(),
    isStopping: false,
  }),
  useDesignMessages: () => [],
  useDesignMessagesLoading: () => false,
  useIsDesigning: () => false,
  useDesignerOpen: () => storeState.designerOpen,
  useCopilotMode: () => storeState.copilotMode,
  useCurrentExecution: () => storeState.currentExecution,
  useLatestExecutionForPlaybook: () => storeState.currentExecution,
  useSelectedStep: () => 'task-1',
  useIsDirty: () => false,
}));

function buildExecution(options: {
  type: InterruptType;
  riskLevel?: string;
    feedbackScopeDefault?: HitlFeedbackScope;
    blockerRuleId?: string;
    pendingCount?: number;
}): PlaybookExecution {
  return {
    id: 'execution-1',
    playbookId: 'playbook-1',
    executedBy: 'user-1',
    executionNumber: 1,
    status: 'interrupted',
    taskResults: [{
      taskId: 'task-1',
      nodeTitle: 'Review contract',
      agentName: 'Agent',
      order: 0,
      status: 'interrupted',
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      components: [],
    }],
    threadId: 'thread-1',
    interruptPayload: {
      type: options.type,
      taskId: 'task-1',
      taskTitle: 'Review contract',
      message: 'Need human input',
      threadId: 'thread-1',
      interruptId: 'interrupt-1',
      riskLevel: options.riskLevel,
      feedbackScopeDefault: options.feedbackScopeDefault,
      blockerRuleId: options.blockerRuleId,
    },
    pendingInterrupts: Array.from({ length: options.pendingCount ?? 1 }, (_, index) => ({
      type: index === 0 ? options.type : 'approval_request',
      taskId: `task-${index + 1}`,
      taskTitle: `Task ${index + 1}`,
      message: index === 0 ? 'Need human input' : 'Approve next?',
      threadId: 'thread-1',
      interruptId: `interrupt-${index + 1}`,
      riskLevel: index === 0 ? options.riskLevel : 'medium',
      feedbackScopeDefault: index === 0 ? options.feedbackScopeDefault : undefined,
      blockerRuleId: index === 0 ? options.blockerRuleId : undefined,
    })),
    waitingForHumanInput: true,
    currentInterruptId: 'interrupt-1',
    currentInterruptTaskId: 'task-1',
    hitlHistory: [],
    error: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    singleStepTaskId: null,
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    reflectionEnabled: false,
    advisorScoringMode: 'heuristic',
    advisorAutopilotStatus: 'idle',
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  };
}

async function renderInterruptPanel(execution: PlaybookExecution) {
  storeState.currentExecution = execution;
  render(<PlaybookDesignerPanel playbookId="playbook-1" />);
  await waitFor(() => expect(screen.getByLabelText('interrupt.scopeLabel')).toBeInTheDocument());
}

describe('PlaybookDesignerPanel HITL feedback scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.currentExecution = null;
    storeState.copilotMode = 'interrupt';
    storeState.designerOpen = true;
    storeState.resumeExecution = vi.fn().mockResolvedValue(undefined);
    storeState.disableHitlBlocker = vi.fn().mockResolvedValue(undefined);
    storeState.selectStep = vi.fn();
  });

  it('defaults sensitive approvals to step-only feedback without memory', async () => {
    await renderInterruptPanel(buildExecution({ type: 'approval_request', riskLevel: 'critical' }));

    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('step_only');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).not.toBeChecked();
  });

  it('defaults non-sensitive clarification to downstream run feedback', async () => {
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium' }));

    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('downstream_run');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).not.toBeChecked();
  });

  it('uses the backend feedback scope default when present', async () => {
    await renderInterruptPanel(buildExecution({
      type: 'clarification',
      riskLevel: 'medium',
      feedbackScopeDefault: 'future_workflow_runs',
    }));

    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('future_workflow_runs');
  });

  it('shows the pending interrupt queue count', async () => {
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium', pendingCount: 2 }));

    expect(screen.getByText('interrupt.queueTitle:2')).toBeInTheDocument();
    expect(screen.getByText('interrupt.queuePending:1')).toBeInTheDocument();
  });

  it('renders interrupt mode from execution state even when the UI mode is stale', async () => {
    storeState.copilotMode = 'design';

    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium' }));

    expect(screen.getAllByText('interrupt.clarificationTitle').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('interrupt.scopeLabel')).toBeInTheDocument();
    expect(screen.queryByText('designer.empty')).not.toBeInTheDocument();
  });

  it('submits the selected scope and memory consent', async () => {
    const user = userEvent.setup();
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium' }));

    fireEvent.change(screen.getByLabelText('interrupt.scopeLabel'), { target: { value: 'future_node_runs' } });
    await user.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await user.type(screen.getByRole('textbox'), 'Use the signed contract.');
    await user.click(screen.getByRole('button', { name: 'interrupt.submit' }));

    expect(storeState.resumeExecution).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
      executionId: 'execution-1',
      taskId: 'task-1',
      interruptId: 'interrupt-1',
      action: 'reply',
      message: 'Use the signed contract.',
      feedback: 'Use the signed contract.',
      scope: 'future_node_runs',
      remember: true,
    }));
  });

  it('disables the active blocker without changing scope or memory consent', async () => {
    const user = userEvent.setup();
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium', blockerRuleId: 'blocker-1' }));

    fireEvent.change(screen.getByLabelText('interrupt.scopeLabel'), { target: { value: 'future_node_runs' } });
    await user.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await user.click(screen.getByRole('button', { name: 'interrupt.disableBlocker' }));

    expect(storeState.disableHitlBlocker).toHaveBeenCalledWith('execution-1', 'interrupt-1');
    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('future_node_runs');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).toBeChecked();
  });

  it('keeps the answered HITL thread visible after the active interrupt clears', async () => {
    const execution = {
      ...buildExecution({ type: 'clarification', riskLevel: 'medium' }),
      status: 'running' as const,
      interruptPayload: null,
      pendingInterrupts: [],
      waitingForHumanInput: false,
      currentInterruptId: null,
      currentInterruptTaskId: null,
      hitlHistory: [{
        interruptId: 'interrupt-1',
        taskId: 'task-1',
        type: 'clarification',
        taskTitle: 'Review contract',
        message: 'Which country should I search?',
        taskDescription: 'Search agro leads.',
        result: '',
        round: 1,
        payloadJson: '',
        resumableActions: ['reply'],
        status: 'answered' as const,
        responseAction: 'reply',
        responseMessage: 'France',
        responseApproved: null,
        responseReason: null,
        responseFeedback: 'France',
        respondedBy: null,
        respondedAt: null,
        createdAt: '2026-05-31T00:00:00.000Z',
      }],
    };

    storeState.currentExecution = execution;
    render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    expect(await screen.findByText('Which country should I search?')).toBeInTheDocument();
    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.getByText('interrupt.threadIdleTitle')).toBeInTheDocument();
    expect(screen.queryByText('copilot.empty')).not.toBeInTheDocument();
  });
});
