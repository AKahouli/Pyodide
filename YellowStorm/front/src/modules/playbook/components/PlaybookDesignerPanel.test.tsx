import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookDesignerPanel } from './PlaybookDesignerPanel';
import type { DesignMessage, HitlFeedbackScope, IntentSuggestionHistoryEntry, InterruptType, Playbook, PlaybookExecution, PlaybookIntentDesignResponse, PlaybookIntentSuggestion } from '../types';

type StoreSnapshot = {
  currentPlaybook: Playbook | null;
  currentExecution: PlaybookExecution | null;
  designMessages: DesignMessage[];
  copilotMode: 'design' | 'interrupt';
  designerOpen: boolean;
  clearDesignMessages: ReturnType<typeof vi.fn>;
  resumeExecution: ReturnType<typeof vi.fn>;
  disableHitlBlocker: ReturnType<typeof vi.fn>;
  fetchDesignMessages: ReturnType<typeof vi.fn>;
  selectStep: ReturnType<typeof vi.fn>;
  setDesignerOpen: ReturnType<typeof vi.fn>;
  setCopilotMode: ReturnType<typeof vi.fn>;
};

const createHitlBlockerMock = vi.fn();
const updateNodeHitlPolicyMock = vi.fn();
let isDesigning = false;

const storeState: StoreSnapshot = {
  currentPlaybook: null,
  currentExecution: null,
  designMessages: [],
  copilotMode: 'interrupt',
  designerOpen: true,
  clearDesignMessages: vi.fn(),
  resumeExecution: vi.fn(),
  disableHitlBlocker: vi.fn(),
  fetchDesignMessages: vi.fn(),
  selectStep: vi.fn(),
  setDesignerOpen: vi.fn(),
  setCopilotMode: vi.fn(),
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, params?: { count?: number }) => (params?.count ? `${key}:${params.count}` : key) }),
}));

vi.mock('../hooks/useAutosave', () => ({
  useAutosave: () => ({ saveNow: vi.fn() }),
}));

vi.mock('../api', () => ({
  createHitlBlocker: (...args: unknown[]) => createHitlBlockerMock(...args),
  updateNodeHitlPolicy: (...args: unknown[]) => updateNodeHitlPolicyMock(...args),
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

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../store', () => ({
    usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    fetchDesignMessages: storeState.fetchDesignMessages,
    designPlaybook: vi.fn(),
    clearDesignMessages: storeState.clearDesignMessages,
    revertToSnapshot: vi.fn(),
    resumeExecution: storeState.resumeExecution,
    disableHitlBlocker: storeState.disableHitlBlocker,
    setDesignerOpen: storeState.setDesignerOpen,
    setCopilotMode: storeState.setCopilotMode,
    selectStep: storeState.selectStep,
    stopExecution: vi.fn(),
    isStopping: false,
  }),
  useDesignMessages: () => storeState.designMessages,
  useDesignMessagesLoading: () => false,
  useIsDesigning: () => isDesigning,
  useDesignerOpen: () => storeState.designerOpen,
  useCopilotMode: () => storeState.copilotMode,
  useCurrentExecution: () => storeState.currentExecution,
  useCurrentPlaybook: () => storeState.currentPlaybook,
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

function buildPlaybook(): Playbook {
  return {
    id: 'playbook-1',
    name: 'Test playbook',
    description: '',
    definitionRevision: 0,
    designSettings: {
      inferenceModelId: null,
      nodeSuggestionsMode: 'manual',
      approvalSuggestionMode: 'manual',
    },
    effectiveDesignSettings: {
      inferenceModelId: null,
      resolvedInferenceModelId: null,
      nodeSuggestionsMode: 'manual',
      approvalSuggestionMode: 'manual',
    },
    tasks: [{
      id: 'task-1',
      title: 'Lead search',
      description: 'Search agro leads.',
      assignedAgentId: null,
      executionOrder: 0,
      positionX: 0,
      positionY: 0,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: true,
      clarificationPrompt: '',
      maxClarifications: 3,
      inputKeys: [],
      outputKey: '',
      notifyOnComplete: false,
      notifyEmails: [],
      inputFiles: [],
    }],
    edges: [],
    reflectionEnabled: false,
    workspaces: [],
    createdBy: 'user-1',
    isFavorite: false,
    isActive: true,
    executionSchedule: null,
    triggers: [],
    automatedTriggerType: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  };
}

async function renderInterruptPanel(execution: PlaybookExecution) {
  storeState.currentExecution = execution;
  render(<PlaybookDesignerPanel playbookId="playbook-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'interrupt.options' })).toBeInTheDocument());
}

async function openInterruptOptions(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'interrupt.options' }));
  await waitFor(() => expect(screen.getByLabelText('interrupt.scopeLabel')).toBeInTheDocument());
  return user;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('PlaybookDesignerPanel HITL feedback scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDesigning = false;
    storeState.currentPlaybook = buildPlaybook();
    storeState.currentExecution = null;
    storeState.designMessages = [];
    storeState.copilotMode = 'interrupt';
    storeState.designerOpen = true;
    storeState.resumeExecution = vi.fn().mockResolvedValue(undefined);
    storeState.disableHitlBlocker = vi.fn().mockResolvedValue(undefined);
    storeState.fetchDesignMessages = vi.fn().mockResolvedValue(undefined);
    storeState.selectStep = vi.fn();
    storeState.setDesignerOpen = vi.fn();
    storeState.setCopilotMode = vi.fn();
    createHitlBlockerMock.mockResolvedValue({ id: 'blocker-2' });
    updateNodeHitlPolicyMock.mockResolvedValue({ mode: 'off' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults sensitive approvals to step-only feedback without memory', async () => {
    await renderInterruptPanel(buildExecution({ type: 'approval_request', riskLevel: 'critical' }));
    await openInterruptOptions();

    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('step_only');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).not.toBeChecked();
  });

  it('defaults non-sensitive clarification to downstream run feedback', async () => {
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium' }));
    await openInterruptOptions();

    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('downstream_run');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).not.toBeChecked();
  });

  it('uses the backend feedback scope default when present', async () => {
    await renderInterruptPanel(buildExecution({
      type: 'clarification',
      riskLevel: 'medium',
      feedbackScopeDefault: 'future_workflow_runs',
    }));
    await openInterruptOptions();

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
    expect(screen.queryByLabelText('interrupt.scopeLabel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'interrupt.options' })).toBeInTheDocument();
    expect(screen.queryByText('designer.empty')).not.toBeInTheDocument();
  });

  it('shows blocked history suggestions as available for explicit user apply', async () => {
    storeState.copilotMode = 'design';
    const user = userEvent.setup();
    const onApplyHistorySuggestion = vi.fn();
    const suggestion: PlaybookIntentSuggestion = {
      id: 'blocked-plan',
      kind: 'workflow_plan',
      label: 'Blocked plan',
      summary: 'Validation status is blocked but history apply remains explicit.',
      reason: 'A required input is unbound.',
      confidence: 0.9,
      impact: { nodesToCreate: 1, nodesToUpdate: 0, nodesToDelete: 0, edgesToCreate: 0, edgesToDelete: 0, dataBindingsToCreate: 0, dataBindingsToDelete: 0, affectedTaskIds: [], businessOutcome: '' },
      changes: [],
      validationStatus: 'blocked',
      isDirectIntentFallback: false,
    };

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      history={[{ id: 'history-1', suggestion, intent: 'Build blocked workflow', appliedAt: Date.now(), playbookId: 'playbook-1', playbookName: 'Test playbook' }]}
      onApplyHistorySuggestion={onApplyHistorySuggestion}
    />);

    await user.click(screen.getByRole('button', { name: 'intentBar.history.title' }));

    expect(screen.getByText('Build blocked workflow')).toBeInTheDocument();
    const historyButton = screen.getByRole('button', { name: /Build blocked workflow/ });
    expect(historyButton).toBeEnabled();
    await user.click(historyButton);
    expect(onApplyHistorySuggestion).toHaveBeenCalledWith(suggestion);
  });

  it('submits the selected scope and memory consent', async () => {
    const user = userEvent.setup();
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium' }));
    await openInterruptOptions(user);

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
    await openInterruptOptions(user);

    fireEvent.change(screen.getByLabelText('interrupt.scopeLabel'), { target: { value: 'future_node_runs' } });
    await user.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await user.click(screen.getByRole('button', { name: 'interrupt.disableBlocker' }));

    expect(storeState.disableHitlBlocker).toHaveBeenCalledWith('execution-1', 'interrupt-1');
    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('future_node_runs');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).toBeChecked();
  });

  it('offers the run-mode blocker quick actions', async () => {
    const user = userEvent.setup();
    await renderInterruptPanel(buildExecution({ type: 'clarification', riskLevel: 'medium', blockerRuleId: 'blocker-1' }));
    await openInterruptOptions(user);

    await user.click(screen.getByRole('button', { name: 'interrupt.disableSmartForNode' }));
    expect(updateNodeHitlPolicyMock).toHaveBeenCalledWith('playbook-1', 'task-1', expect.objectContaining({ mode: 'off' }));

    await user.click(screen.getByRole('button', { name: 'interrupt.saveWorkflowRule' }));
    expect(createHitlBlockerMock).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
      scope: 'workflow',
      nodeId: null,
      action: 'clarify',
    }));

    await user.click(screen.getByRole('button', { name: 'interrupt.disableForRun' }));

    expect(storeState.resumeExecution).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
      executionId: 'execution-1',
      interruptId: 'interrupt-1',
      action: 'reply',
      scope: 'entire_run',
      remember: false,
    }));
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
    expect(screen.queryByText('interrupt.threadIdleTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('copilot.empty')).not.toBeInTheDocument();
  });

  it('keeps task context out of the visible chat transcript', async () => {
    const execution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    execution.interruptPayload = {
      ...execution.interruptPayload!,
      message: 'How many leads should I search for?',
      taskDescription: 'Search agro leads in France.',
    };

    await renderInterruptPanel(execution);

    expect(screen.getByText('How many leads should I search for?')).toBeInTheDocument();
    expect(screen.queryByText('interrupt.taskDescription')).not.toBeInTheDocument();
    expect(screen.getByLabelText('interrupt.contextTooltip')).toBeInTheDocument();
  });

  it('renders embedded prior clarification feedback as a user bubble', async () => {
    const execution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    execution.taskResults[0].nodeTitle = '';
    execution.interruptPayload = {
      ...execution.interruptPayload!,
      taskTitle: 'Interrupted step',
      message: 'How many agro sector leads should I search for?',
      taskDescription: 'need to search leads in agro sector\nClarification from user: france',
    };

    await renderInterruptPanel(execution);

    expect(screen.getByText('interrupt.assistantInbox')).toBeInTheDocument();
    expect(screen.getByText('Lead search')).toBeInTheDocument();
    expect(screen.getByText('france')).toBeInTheDocument();
    expect(screen.getByText('How many agro sector leads should I search for?')).toBeInTheDocument();
    expect(screen.queryByText('interrupt.taskDescription')).not.toBeInTheDocument();
  });

  it('does not duplicate legacy embedded feedback when structured history already has the response', async () => {
    const execution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    execution.interruptPayload = {
      ...execution.interruptPayload!,
      interruptId: 'interrupt-2',
      message: 'How many agro sector leads should I search for?',
      taskDescription: 'Clarification from user: france',
    };
    execution.hitlHistory = [{
      interruptId: 'interrupt-1',
      taskId: execution.interruptPayload.taskId,
      type: 'clarification',
      taskTitle: 'Lead search',
      message: 'Which region should I search?',
      taskDescription: '',
      result: '',
      round: 0,
      payloadJson: '',
      resumableActions: [],
      status: 'answered',
      responseAction: 'reply',
      responseMessage: 'france',
      responseApproved: null,
      responseReason: null,
      responseFeedback: null,
      responseScope: 'downstream_run',
      responseRemember: false,
      respondedBy: null,
      respondedAt: '2026-06-02T08:47:00.000Z',
      createdAt: '2026-06-02T08:46:00.000Z',
    }];

    await renderInterruptPanel(execution);

    expect(screen.getAllByText('france')).toHaveLength(1);
    expect(screen.getByText('How many agro sector leads should I search for?')).toBeInTheDocument();
  });

  it('preserves the visible HITL thread after submitting and resuming execution', async () => {
    const user = userEvent.setup();
    const activeExecution = buildExecution({ type: 'clarification', riskLevel: 'medium', blockerRuleId: 'blocker-1' });
    activeExecution.interruptPayload = {
      ...activeExecution.interruptPayload!,
      message: 'Which region should I search?',
    };
    storeState.currentExecution = activeExecution;

    const { rerender } = render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    await user.type(screen.getByRole('textbox'), 'France');
    await user.click(screen.getByRole('button', { name: 'interrupt.submit' }));

    storeState.currentExecution = {
      ...activeExecution,
      status: 'running',
      interruptPayload: null,
      pendingInterrupts: [],
      waitingForHumanInput: false,
      currentInterruptId: null,
      currentInterruptTaskId: null,
      hitlHistory: [],
    };
    rerender(<PlaybookDesignerPanel playbookId="playbook-1" />);

    expect(screen.getByText('Which region should I search?')).toBeInTheDocument();
    expect(screen.getByText('France')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('interrupt.thinking')).not.toBeInTheDocument());
    expect(screen.getByText('interrupt.runningWithFeedback')).toBeInTheDocument();
    expect(screen.queryByText('copilot.empty')).not.toBeInTheDocument();
    expect(screen.queryByText('interrupt.threadIdleTitle')).not.toBeInTheDocument();
  });

  it('keeps the composer visible and disabled while the assistant is thinking', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    storeState.resumeExecution = vi.fn().mockReturnValue(deferred.promise);
    const activeExecution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    activeExecution.interruptPayload = {
      ...activeExecution.interruptPayload!,
      message: 'Which region should I search?',
    };

    await renderInterruptPanel(activeExecution);
    await openInterruptOptions(user);
    await user.type(screen.getByRole('textbox'), 'France');
    await user.click(screen.getByRole('button', { name: 'interrupt.submit' }));

    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.getAllByText('interrupt.thinking').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('interrupt.waitingPlaceholder')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'interrupt.options' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'interrupt.disableForRun' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'interrupt.disableForStep' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'interrupt.disableSmartForNode' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'interrupt.saveWorkflowRule' })).toBeDisabled();
  });

  it('re-enables the composer and restores the draft when interrupt resume fails', async () => {
    const user = userEvent.setup();
    storeState.resumeExecution = vi.fn().mockRejectedValue(new Error('resume failed'));
    const activeExecution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    activeExecution.interruptPayload = {
      ...activeExecution.interruptPayload!,
      message: 'Which region should I search?',
    };

    await renderInterruptPanel(activeExecution);
    await openInterruptOptions(user);
    await user.selectOptions(screen.getByLabelText('interrupt.scopeLabel'), 'future_node_runs');
    await waitFor(() => expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('future_node_runs'));
    await user.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await user.type(screen.getByRole('textbox'), 'France');
    await user.click(screen.getByRole('button', { name: 'interrupt.submit' }));

    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('France');
    expect(screen.getByRole('button', { name: 'interrupt.options' })).toBeEnabled();
    expect(screen.getByLabelText('interrupt.scopeLabel')).toHaveValue('future_node_runs');
    expect(screen.getByLabelText('interrupt.rememberFeedback')).toBeChecked();
    expect(screen.queryByText('interrupt.thinking')).not.toBeInTheDocument();
  });

  it('appends a follow-up interrupt without losing earlier feedback history', async () => {
    const user = userEvent.setup();
    const firstExecution = buildExecution({ type: 'clarification', riskLevel: 'medium' });
    firstExecution.interruptPayload = {
      ...firstExecution.interruptPayload!,
      message: 'Which region should I search?',
    };
    storeState.currentExecution = firstExecution;

    const { rerender } = render(<PlaybookDesignerPanel playbookId="playbook-1" />);
    await user.type(screen.getByRole('textbox'), 'France');
    await user.click(screen.getByRole('button', { name: 'interrupt.submit' }));

    storeState.currentExecution = {
      ...firstExecution,
      interruptPayload: {
        ...firstExecution.interruptPayload!,
        interruptId: 'interrupt-2',
        message: 'How many leads should I search for?',
      },
      currentInterruptId: 'interrupt-2',
      pendingInterrupts: [{
        ...firstExecution.pendingInterrupts![0],
        interruptId: 'interrupt-2',
        message: 'How many leads should I search for?',
      }],
      hitlHistory: [],
    };
    rerender(<PlaybookDesignerPanel playbookId="playbook-1" />);

    expect(screen.getByText('Which region should I search?')).toBeInTheDocument();
    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.getByText('How many leads should I search for?')).toBeInTheDocument();
  });

  it('shows a reopen control when the HITL assistant is collapsed', async () => {
    const user = userEvent.setup();
    storeState.designerOpen = false;
    storeState.currentExecution = buildExecution({ type: 'clarification', riskLevel: 'medium' });

    render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    const collapsedPanel = document.querySelector('[aria-labelledby="playbook-designer-panel-title"]');
    expect(collapsedPanel).toHaveAttribute('inert');
    expect(collapsedPanel).not.toHaveAttribute('aria-hidden');

    await user.click(screen.getByRole('button', { name: 'interrupt.reopenAssistant' }));

    expect(storeState.setCopilotMode).toHaveBeenCalledWith('interrupt');
    expect(storeState.setDesignerOpen).toHaveBeenCalledWith(true);
  });

  it('submits design-mode sidebar messages through the intent callback', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-22T08:10:11'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    await user.type(screen.getByPlaceholderText('designer.inputPlaceholder'), 'Add a lead scoring step{Enter}');

    expect(onSubmitDesignIntent).toHaveBeenCalledWith(
      'Add a lead scoring step',
      'Add a lead scoring step',
    );
  });

  it('leaves design-mode chat history to the server-owned conversation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-21T22:37:05'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    storeState.copilotMode = 'design';
    storeState.designMessages = [
      {
        id: 'message-1',
        playbookId: 'playbook-1',
        userQuery: 'leadgen\npipeline',
        aiSummary: 'Which Telegram source\nshould I use?',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: '2026-06-21T22:34:05',
        updatedAt: '2026-06-21T22:34:05',
      },
      {
        id: 'message-reverted',
        playbookId: 'playbook-1',
        userQuery: 'unused reverted request',
        aiSummary: 'unused reverted reply',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'reverted',
        revertedFromMessageId: null,
        error: null,
        createdAt: '2026-06-21T22:35:05',
        updatedAt: '2026-06-21T22:35:05',
      },
      {
        id: 'message-2',
        playbookId: 'playbook-1',
        userQuery: 'add exports',
        aiSummary: 'Export failed.',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'failed',
        revertedFromMessageId: null,
        error: 'Missing output schema',
        createdAt: '2026-06-21T22:36:05',
        updatedAt: '2026-06-21T22:36:05',
      },
    ];

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    await user.type(screen.getByPlaceholderText('designer.inputPlaceholder'), 'Add scoring{Enter}');

    expect(onSubmitDesignIntent).toHaveBeenCalledWith('Add scoring', 'Add scoring');
  });

  it('renders server-owned assistant messages without legacy history mutations', () => {
    storeState.copilotMode = 'design';
    storeState.designMessages = [{
      id: 'legacy-message',
      playbookId: 'playbook-1',
      userQuery: 'Legacy request',
      aiSummary: 'Legacy answer',
      snapshotBefore: { tasks: [], edges: [] },
      status: 'completed',
      revertedFromMessageId: null,
      error: null,
      createdAt: '2026-06-21T22:34:05',
      updatedAt: '2026-06-21T22:34:05',
    }];

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      assistantMessages={[
        { messageId: 'user-1', role: 'user', content: 'What is the title?', operationId: null, createdAt: '2026-06-21T22:35:05' },
        { messageId: 'assistant-1', role: 'assistant', content: 'Lead generation', operationId: null, createdAt: '2026-06-21T22:35:06' },
      ]}
    />);

    expect(screen.getByText('What is the title?')).toBeInTheDocument();
    expect(screen.getByText('Lead generation')).toBeInTheDocument();
    expect(screen.queryByText('Legacy request')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'designer.clearMemory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'designer.revert' })).not.toBeInTheDocument();
    expect(storeState.fetchDesignMessages).not.toHaveBeenCalled();
  });

  it('restores the design-mode draft when intent submission fails', async () => {
    const user = userEvent.setup();
    const onSubmitDesignIntent = vi.fn().mockRejectedValue(new Error('submit failed'));
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);
    storeState.fetchDesignMessages.mockClear();

    await user.type(screen.getByPlaceholderText('designer.inputPlaceholder'), 'Add scoring{Enter}');

    await waitFor(() => expect(screen.getByPlaceholderText('designer.inputPlaceholder')).toHaveValue('Add scoring'));
    expect(storeState.fetchDesignMessages).not.toHaveBeenCalled();
  });

  it('renders design message timestamps with date and seconds', () => {
    storeState.copilotMode = 'design';
    storeState.designMessages = [{
      id: 'message-1',
      playbookId: 'playbook-1',
      userQuery: 'leadgen pipeline',
      aiSummary: 'Created a lead workflow.',
      snapshotBefore: { tasks: [], edges: [] },
      status: 'completed',
      revertedFromMessageId: null,
      error: null,
      createdAt: '2026-06-21T22:34:05',
      updatedAt: '2026-06-21T22:34:05',
    }];

    render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    expect(screen.getByText('2026-06-21 22:34:05')).toBeInTheDocument();
  });

  it('renders design clarification choices inside the assistant pane', async () => {
    const user = userEvent.setup();
    const onAnswerDesignIntent = vi.fn().mockResolvedValue(undefined);
    const intentDesign: PlaybookIntentDesignResponse = {
      status: 'needs_clarification',
      detectedIntent: 'Build lead search',
      missingRequirements: [],
      riskFlags: [],
      questions: [{
        id: 'region',
        question: 'Which region should I search?',
        reason: 'The workflow needs a target market.',
        category: 'scope',
        required: true,
        choices: ['France', 'Germany'],
      }],
    };
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" intentDesign={intentDesign} onAnswerDesignIntent={onAnswerDesignIntent} />);

    expect(screen.getByText('Which region should I search?')).toBeInTheDocument();
    expect(screen.queryByText('The workflow needs a target market.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /France/ }));
    await user.click(screen.getByRole('button', { name: 'intentBar.design.generate' }));

    expect(onAnswerDesignIntent).toHaveBeenCalledWith(
      [{ questionId: 'region', choice: 'France' }],
      'Which region should I search?: France',
    );
  });

  it('renders a left-edge resize handle', () => {
    const { container } = render(<PlaybookDesignerPanel playbookId="playbook-1" />);
    const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
    expect(handle).toBeTruthy();
  });

  it('defaults the sidebar width to 576px (1.5x the previous 384px)', () => {
    const { container } = render(<PlaybookDesignerPanel playbookId="playbook-1" />);
    const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
    const panel = handle.parentElement as HTMLElement;
    expect(panel.style.width).toBe('576px');
    expect(panel.style.maxWidth).toBe('100vw');
  });

  it('clears the canvas sidebar width when unmounted', () => {
    const onWidthChange = vi.fn();
    const { unmount } = render(<PlaybookDesignerPanel playbookId="playbook-1" onWidthChange={onWidthChange} />);

    unmount();

    expect(onWidthChange).toHaveBeenLastCalledWith(0);
  });

  it('contains keyboard interaction in the mobile Designer dialog', async () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);

    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('fixed', 'inset-0', 'sm:absolute');
    expect(dialog).toHaveFocus();

    const clientRectsSpy = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
    const controls = within(dialog).getAllByRole('button').filter((button) => !button.hasAttribute('disabled'));
    const firstControl = controls[0];
    const lastControl = controls[controls.length - 1];

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();
    fireEvent.keyDown(lastControl, { key: 'Tab' });
    expect(firstControl).toHaveFocus();
    fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();

    document.body.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(storeState.setDesignerOpen).toHaveBeenCalledWith(false);
    storeState.designerOpen = false;
    rerender(<PlaybookDesignerPanel playbookId="playbook-1" />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
    clientRectsSpy.mockRestore();
    matchMediaSpy.mockRestore();
  });

  it('keeps multiline sidebar prompts when Alt+Enter is used', async () => {
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    const input = screen.getByPlaceholderText('designer.inputPlaceholder');
    fireEvent.change(input, { target: { value: 'First line' } });
    fireEvent.keyDown(input, { key: 'Enter', altKey: true });
    expect(onSubmitDesignIntent).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'First line\nSecond line' } });
    expect(input).toHaveValue('First line\nSecond line');
  });

  it('attaches pasted images to the sidebar prompt submission', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-22T08:20:21'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    const input = screen.getByPlaceholderText('designer.inputPlaceholder');
    const image = new File(['image-bytes'], 'diagram.png', { type: 'image/png' });
    fireEvent.paste(input, {
      clipboardData: {
        files: [image],
      },
    });
    await waitFor(() => expect(screen.getByAltText('diagram.png')).toBeInTheDocument());

    await user.type(input, 'Build this workflow{Enter}');

    await waitFor(() => expect(onSubmitDesignIntent).toHaveBeenCalled());
    expect(onSubmitDesignIntent).toHaveBeenCalledWith(
      'Build this workflow [1 image attached]',
      'Build this workflow [1 image attached]',
      [image],
    );
  });

  it('submits pasted images without requiring prompt text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-22T08:20:21'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    const input = screen.getByPlaceholderText('designer.inputPlaceholder');
    const image = new File(['image-bytes'], 'diagram.png', { type: 'image/png' });
    fireEvent.paste(input, {
      clipboardData: {
        files: [image],
      },
    });
    await waitFor(() => expect(screen.getByAltText('diagram.png')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'designer.send' }));

    await waitFor(() => expect(onSubmitDesignIntent).toHaveBeenCalled());
    expect(onSubmitDesignIntent).toHaveBeenCalledWith(
      '[1 image attached]',
      '[1 image attached]',
      [image],
    );
  });

  it('renders sidebar history controls without auto-apply', async () => {
    const onApplyHistorySuggestion = vi.fn();
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      onApplyHistorySuggestion={onApplyHistorySuggestion}
      history={[{
        id: 'history-1',
        playbookId: 'playbook-1',
        playbookName: 'Test',
        intent: 'Improve routing',
        appliedAt: Date.now(),
        suggestion: {
          id: 'suggestion-1',
          kind: 'workflow_plan',
          label: 'Improve routing',
          summary: '',
          reason: '',
          confidence: 0.9,
          isDirectIntentFallback: false,
          changes: [],
          impact: {
            nodesToCreate: 0,
            nodesToUpdate: 0,
            nodesToDelete: 0,
            edgesToCreate: 0,
            edgesToDelete: 0,
            dataBindingsToCreate: 0,
            dataBindingsToDelete: 0,
            affectedTaskIds: [],
            businessOutcome: '',
          },
        },
      }]}
    />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /intentBar.history.title/ }));
    await userEvent.click(screen.getByRole('button', { name: /Improve routing/ }));
    expect(onApplyHistorySuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'suggestion-1' }));
    expect(screen.getByRole('button', { name: 'designer.clearMemory' })).toBeInTheDocument();
  });

  it('clears design chat memory from the visible sidebar control', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    storeState.copilotMode = 'design';
    storeState.designMessages = [{
      id: 'message-1',
      playbookId: 'playbook-1',
      userQuery: 'Build a workflow',
      aiSummary: 'Done',
      snapshotBefore: null,
      status: 'completed',
      revertedFromMessageId: null,
      error: null,
      createdAt: '2026-06-22T08:20:21.000Z',
      updatedAt: '2026-06-22T08:20:21.000Z',
    } as unknown as DesignMessage];

    render(<PlaybookDesignerPanel playbookId="playbook-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'designer.clearMemory' }));

    expect(confirmSpy).toHaveBeenCalledWith('designer.clearMemoryConfirm');
    expect(storeState.clearDesignMessages).toHaveBeenCalledWith('playbook-1');
    confirmSpy.mockRestore();
  });

  it('switches the sidebar send button to stop during construction', async () => {
    const onCancelConstruction = vi.fn();
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" constructionStatus="streaming" onCancelConstruction={onCancelConstruction} />);

    await userEvent.click(screen.getByRole('button', { name: 'intentBar.actions.stop' }));
    expect(onCancelConstruction).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer usable when the unrelated legacy design operation is stale', async () => {
    const onSubmitDesignIntent = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    isDesigning = true;
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" onSubmitDesignIntent={onSubmitDesignIntent} />);

    await user.type(screen.getByPlaceholderText('designer.inputPlaceholder'), 'Add a QA step');
    await user.click(screen.getByRole('button', { name: 'designer.send' }));

    expect(onSubmitDesignIntent).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer disabled during an active intent request', () => {
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel playbookId="playbook-1" intentLoading onSubmitDesignIntent={vi.fn()} />);

    expect(screen.getByPlaceholderText('designer.inputPlaceholder')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'designer.send' })).toBeDisabled();
  });

  it('does not show an apply or discard gate after direct construction completes', () => {
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      constructionStatus="completed"
    />);

    expect(screen.queryByRole('button', { name: 'intentBar.preview.apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'intentBar.preview.discard' })).not.toBeInTheDocument();
  });

  it('shows actionable generated-workflow diagnostics and reviews the affected node', async () => {
    const onReview = vi.fn();
    storeState.copilotMode = 'design';
    const diagnostic = {
      severity: 'warning' as const,
      stage: 'repair' as const,
      code: 'repair_template_required_port_added',
      itemId: 'prepare_report',
      message: 'repair_template_required_port_added',
      reviewTarget: { kind: 'port' as const, nodeRef: 'prepare_report', nodeLabel: 'Prepare report', portId: 'context' },
      resolutionCode: 'review_port' as const,
    };

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      constructionDiagnostics={[diagnostic]}
      onReviewConstructionDiagnostic={onReview}
    />);

    expect(screen.getByText('Prepare report / context')).toBeInTheDocument();
    expect(screen.getByText('intentBar.diagnostics.resolution.review_port')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /intentBar.diagnostics.reviewNode/ }));
    expect(onReview).toHaveBeenCalledWith(diagnostic);
  });

  it('keeps explicit Apply and Discard for an Advisor preview', async () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      constructionStatus="completed"
      assistantPreviewStatus="ready"
      onApplyAssistantPreview={onApply}
      onDiscardAssistantPreview={onDiscard}
    />);

    await userEvent.click(screen.getByRole('button', { name: 'intentBar.preview.apply' }));
    await userEvent.click(screen.getByRole('button', { name: 'intentBar.preview.discard' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('keeps only the stop action while direct construction is streaming', () => {
    storeState.copilotMode = 'design';

    render(<PlaybookDesignerPanel
      playbookId="playbook-1"
      constructionStatus="streaming"
      onCancelConstruction={vi.fn()}
      onApplyHistorySuggestion={vi.fn()}
      history={[{
        id: 'history-streaming',
        playbookId: 'playbook-1',
        playbookName: 'Test',
        intent: 'Replace workflow',
        appliedAt: Date.now(),
        suggestion: { id: 'suggestion-streaming', kind: 'workflow_plan', changes: [], impact: {} },
      } as unknown as IntentSuggestionHistoryEntry]}
    />);

    expect(screen.queryByRole('button', { name: 'intentBar.preview.apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'intentBar.preview.discard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'intentBar.actions.stop' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /intentBar.history.title/ })).toBeDisabled();
  });
});
