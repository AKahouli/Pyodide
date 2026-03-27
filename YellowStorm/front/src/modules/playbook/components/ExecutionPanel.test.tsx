import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionPanel } from './ExecutionPanel';
import { usePlaybookStore } from '../store';
import { makeExecution, makeExecutionSummary, makePlaybook } from '../test-utils';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span data-testid="badge">{status}</span>,
}));

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

  it('auto-loads latest execution when history exists and playbook matches', () => {
    const summary = makeExecutionSummary({ id: 'e1', playbookId: 'p1' });
    const playbook = makePlaybook({ id: 'p1' });
    const execution = makeExecution({ id: 'e1', playbookId: 'p1' });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      executionHistory: [summary],
      currentPlaybook: playbook,
      executionCache: { e1: execution },
    });
    render(<ExecutionPanel />);
    // Auto-load kicks in — should show the execution with badge(s)
    expect(screen.getAllByTestId('badge').length).toBeGreaterThan(0);
    expect(usePlaybookStore.getState().currentExecution?.id).toBe('e1');
  });

  it('renders execution header with status and duration', () => {
    const execution = makeExecution({ status: 'completed', durationMs: 4500 });
    usePlaybookStore.setState({
      executionPanelOpen: true,
      currentExecution: execution,
    });
    render(<ExecutionPanel />);
    expect(screen.getByText('execution.title')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('4s')).toBeInTheDocument();
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

  it('closes panel via setExecutionPanelOpen(false)', () => {
    usePlaybookStore.setState({ executionPanelOpen: true });
    usePlaybookStore.getState().setExecutionPanelOpen(false);
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
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
      selectedStepId: 't1',
    });
    render(<ExecutionPanel />);
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
