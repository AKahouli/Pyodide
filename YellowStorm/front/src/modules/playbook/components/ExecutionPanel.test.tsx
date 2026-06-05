import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionPanel } from './ExecutionPanel';
import { usePlaybookStore } from '../store';
import { usePlaybookUiStore } from '../uiStore';
import { makeExecution, makeExecutionSummary, makePlaybook } from '../test-utils';

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span data-testid="badge">{status}</span>,
}));

function selectStepInBothStores(taskId: string | null) {
  usePlaybookStore.getState().selectStep(taskId);
}

function setStepIdDirectly(taskId: string | null) {
  usePlaybookStore.setState({ selectedStepId: taskId });
  usePlaybookUiStore.setState({ selectedStepId: taskId });
}

describe('ExecutionPanel', () => {
  beforeEach(() => {
    usePlaybookStore.getState().reset();
  });

  afterEach(() => {
    usePlaybookStore.getState().reset();
  });

  it('shows empty state with no-execution message when no history', () => {
    usePlaybookStore.setState({ executionPanelOpen: true });
    render(<ExecutionPanel />);
    expect(screen.getByText('execution.noExecution')).toBeInTheDocument();
  });

  it('auto-loads latest execution when history exists and playbook matches', async () => {
    const summary = makeExecutionSummary({ id: 'e1', playbookId: 'p1' });
    const playbook = makePlaybook({ id: 'p1' });
    const execution = makeExecution({ id: 'e1', playbookId: 'p1' });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      executionHistory: [summary],
      currentPlaybook: playbook,
      executionCache: { e1: execution },
    });
    render(<ExecutionPanel playbookId="p1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('badge').length).toBeGreaterThan(0);
    });
  });

  it('does not render another playbook execution when scoped to a different playbook', () => {
    const playbook = makePlaybook({ id: 'p2' });
    const foreignExecution = makeExecution({ id: 'e-a', playbookId: 'p1', status: 'running' });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentPlaybook: playbook,
      currentExecution: foreignExecution,
      executionHistory: [makeExecutionSummary({ id: 'e-a', playbookId: 'p1', status: 'running' })],
      executionCache: { 'e-a': foreignExecution },
    });

    render(<ExecutionPanel playbookId="p2" />);

    expect(screen.getByText('execution.noExecution')).toBeInTheDocument();
    expect(screen.queryByText('execution.stop')).not.toBeInTheDocument();
  });

  it('renders execution header with status and duration', () => {
    const execution = makeExecution({
      status: 'completed',
      durationMs: 4500,
      taskResults: [{ ...makeExecution().taskResults[0], status: 'completed' }],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(screen.getByText('execution.title')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('4s')).toBeInTheDocument();
  });

  it('shows delete button for completed/failed executions', async () => {
    const execution = makeExecution({
      status: 'completed',
      taskResults: [{ ...makeExecution().taskResults[0], status: 'completed' }],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(screen.queryByTitle('execution.deleteSelected')).toBeInTheDocument();
  });

  it('shows stop button for running execution', () => {
    const execution = makeExecution({ status: 'running' });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(screen.getByText('execution.stop')).toBeInTheDocument();
  });

  it('shows running header when a step is running even if the execution status is completed', () => {
    const execution = makeExecution({
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 't1', status: 'running' },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('execution.stop')).toBeInTheDocument();
  });

  it('shows replay evaluation rerun action in evaluation tab', async () => {
    const execution = makeExecution({
      status: 'completed',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 92,
      advisorAutopilotMaxTurns: 4,
      taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'completed' }],
    });
    const playbook = makePlaybook({
      id: 'playbook-1',
      reflectionEnabled: false,
      tasks: [{ ...makePlaybook().tasks[0], id: 't1', stepReplayMode: 'live' }],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      currentPlaybook: playbook,
      executionHistory: [makeExecutionSummary({ id: execution.id, playbookId: execution.playbookId, status: 'completed' })],
    });
    setStepIdDirectly('t1');

    const user = userEvent.setup();
    render(<ExecutionPanel />);

    await user.click(screen.getByRole('tab', { name: 'detail.tabs.evaluation' }));
    expect(screen.getByText('detail.actions.runReplayEvaluation')).toBeInTheDocument();
  });

  it('wires advisor evaluation CTA through the execution panel store action', async () => {
    const execution = makeExecution({
      id: 'exec-advisor',
      status: 'completed',
      taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'completed', judgeStatus: 'idle' }],
    });
    const runAdvisorEvaluation = vi.fn().mockResolvedValue(undefined);
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      runAdvisorEvaluation,
    });
    setStepIdDirectly('t1');

    render(<ExecutionPanel />);

    await userEvent.click(screen.getByRole('tab', { name: 'detail.tabs.judge' }));
    await userEvent.click(screen.getAllByText('detail.actions.runAdvisorEvaluation')[0]);

    expect(runAdvisorEvaluation).toHaveBeenCalledWith('exec-advisor', 't1', undefined);
  });

  it('keeps the advisor evaluation CTA enabled while the execution is still running', async () => {
    const execution = makeExecution({
      id: 'exec-running-advisor',
      status: 'running',
      taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'completed', judgeStatus: 'idle' }],
    });
    const runAdvisorEvaluation = vi.fn().mockResolvedValue(undefined);
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      runAdvisorEvaluation,
      executingPlaybookIds: ['p1'],
    });
    setStepIdDirectly('t1');

    render(<ExecutionPanel />);

    await userEvent.click(screen.getByRole('tab', { name: 'detail.tabs.judge' }));
    const button = screen.getAllByText('detail.actions.runAdvisorEvaluation')[0];
    expect(button).not.toBeDisabled();

    await userEvent.click(button);
    expect(runAdvisorEvaluation).toHaveBeenCalledWith('exec-running-advisor', 't1', undefined);
  });

  it('closes panel via setExecutionPanelOpen(false)', () => {
    usePlaybookStore.setState({ executionPanelOpen: true });
    usePlaybookStore.getState().setExecutionPanelOpen(false);
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
  });

  it('renders a collapse sidebar icon that hides the execution panel', async () => {
    const execution = makeExecution({ status: 'completed' });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });

    render(<ExecutionPanel />);
    await userEvent.click(screen.getByTitle('Collapse sidebar'));

    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
  });

  it('notifies the page when collapsing the sidebar', async () => {
    const execution = makeExecution({ status: 'completed' });
    const onCollapse = vi.fn();
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });

    render(<ExecutionPanel onCollapse={onCollapse} />);
    await userEvent.click(screen.getByTitle('Collapse sidebar'));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('auto-follows running step during live execution', () => {
    const execution = makeExecution({
      status: 'running',
      taskResults: [
        { taskId: 't1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
        { taskId: 't2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'running', output: null, error: null, durationMs: null, startedAt: '', completedAt: null },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      selectedStepId: null,
    });
    render(<ExecutionPanel />);
    // Auto-follow should select the running step
    expect(usePlaybookStore.getState().selectedStepId).toBe('t2');
  });

  it('auto-follows interrupted step with priority over running', () => {
    const execution = makeExecution({
      status: 'interrupted',
      taskResults: [
        { taskId: 't1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'running', output: null, error: null, durationMs: null, startedAt: '', completedAt: null },
        { taskId: 't2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'interrupted', output: null, error: null, durationMs: null, startedAt: '', completedAt: null },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(usePlaybookStore.getState().selectedStepId).toBe('t2');
  });

  it('preserves manually selected step during live execution', () => {
    const execution = makeExecution({
      status: 'running',
      taskResults: [
        { taskId: 't1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
        { taskId: 't2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'running', output: null, error: null, durationMs: null, startedAt: '', completedAt: null },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    setStepIdDirectly('t1');
    render(<ExecutionPanel />);
    expect(usePlaybookStore.getState().selectedStepId).toBe('t1');
  });

  it('selects a step when clicked in the list', async () => {
    const execution = makeExecution({
      status: 'completed',
      taskResults: [
        { taskId: 't1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: 'done', error: null, durationMs: 100, startedAt: '', completedAt: '' },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      selectedStepId: null,
    });
    render(<ExecutionPanel pageMode="run" />);
    await userEvent.click(screen.getByLabelText('Step 1'));
    expect(usePlaybookStore.getState().selectedStepId).toBe('t1');
  });

  it('does not auto-follow for completed executions', () => {
    const execution = makeExecution({
      status: 'completed',
      taskResults: [
        { taskId: 't1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
        { taskId: 't2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'completed', output: null, error: null, durationMs: 200, startedAt: '', completedAt: '' },
      ],
    });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
      selectedStepId: 't1',
    });
    render(<ExecutionPanel />);
    // Should stay on t1, not auto-follow
    expect(usePlaybookStore.getState().selectedStepId).toBe('t1');
  });
});
