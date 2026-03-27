import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionHeader } from './ExecutionHeader';
import { makeExecution, makePlaybook } from '../test-utils';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock, useParams: () => ({ id: 'p1' }) };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span data-testid="badge">{status}</span>,
}));

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    useIsStopping: () => false,
    usePlaybookStore: (sel: any) => sel({
      stopExecution: vi.fn(),
    }),
  };
});

vi.mock('./ExecutionHistoryDropdown', () => ({
  ExecutionHistoryDropdown: () => <div data-testid="history-dropdown" />,
}));

describe('ExecutionHeader', () => {
  it('renders playbook name and status badge', () => {
    const execution = makeExecution({ status: 'completed', durationMs: 3000 });
    const playbook = makePlaybook({ name: 'My Playbook' });
    render(<ExecutionHeader execution={execution} playbook={playbook} />);
    expect(screen.getByText('My Playbook')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
  });

  it('shows stop button for running execution', () => {
    const execution = makeExecution({ status: 'running' });
    render(<ExecutionHeader execution={execution} playbook={null} />);
    expect(screen.getByText('execution.stop')).toBeInTheDocument();
  });

  it('does not show stop button for completed execution', () => {
    const execution = makeExecution({ status: 'completed' });
    render(<ExecutionHeader execution={execution} playbook={null} />);
    expect(screen.queryByText('execution.stop')).not.toBeInTheDocument();
  });

  it('shows error message for failed execution', () => {
    const execution = makeExecution({ status: 'failed', error: 'Network error' });
    render(<ExecutionHeader execution={execution} playbook={null} />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders back button that navigates to playbook', async () => {
    render(<ExecutionHeader execution={makeExecution()} playbook={null} />);
    const backBtn = screen.getAllByRole('button')[0];
    await userEvent.click(backBtn);
    expect(navigateMock).toHaveBeenCalledWith('/playbooks/p1');
  });

  it('renders history dropdown', () => {
    render(<ExecutionHeader execution={makeExecution()} playbook={null} />);
    expect(screen.getByTestId('history-dropdown')).toBeInTheDocument();
  });
});
