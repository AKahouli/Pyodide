import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookCard } from './PlaybookCard';
import type { PlaybookSummary } from '../types';
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

vi.mock('@/lib/api/config', () => ({
  API_CONFIG: { baseURL: 'http://localhost:3000/api/v1' },
  API_ENDPOINTS: {
    playbooks: {
      publicExecute: (token: string) => `/playbooks/public/${token}/execute`,
    },
  },
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span>{`status.${status}`}</span>,
}));

const playbook: PlaybookSummary = {
  id: 'p1',
  name: 'Deploy Pipeline',
  description: 'Automated deployment',
  taskCount: 5,
  isFavorite: false,
  scheduleEnabled: false,
  executionStatus: null,
  integrationToken: 'integration-token',
  lastExecutionAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-02-01T00:00:00.000Z',
};

describe('PlaybookCard', () => {
  it('renders playbook name and description', () => {
    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);
    expect(screen.getByText('Deploy Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Automated deployment')).toBeInTheDocument();
  });

  it('shows schedule icon when scheduleEnabled is true', () => {
    render(
      <PlaybookCard
        playbook={{ ...playbook, scheduleEnabled: true }}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByTitle('card.scheduled')).toBeInTheDocument();
  });

  it('shows a realtime status badge when execution is running', () => {
    render(
      <PlaybookCard
        playbook={{ ...playbook, executionStatus: 'running' }}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByText('status.running')).toBeInTheDocument();
  });

  it('shows idle when no execution is running', () => {
    render(
      <PlaybookCard
        playbook={{ ...playbook, executionStatus: null }}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByText('status.idle')).toBeInTheDocument();
  });

  it('opens the triggers panel from the shortcut icon', async () => {
    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('card.openTriggers'));
    expect(navigateMock).toHaveBeenCalledWith('/playbooks/p1?triggers=1', { state: { autoLayoutOnOpen: true } });
  });

  it('navigates to playbook on card click', async () => {
    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);
    await userEvent.click(screen.getByText('Deploy Pipeline'));
    expect(navigateMock).toHaveBeenCalledWith('/playbooks/p1', { state: { autoLayoutOnOpen: true } });
  });

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn();
    render(<PlaybookCard playbook={playbook} onDelete={onDelete} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);
    await userEvent.click(screen.getByTitle('card.delete'));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('calls onToggleFavorite when star button is clicked', async () => {
    const onFav = vi.fn();
    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={onFav} />);
    await userEvent.click(screen.getByTitle('card.favorite'));
    expect(onFav).toHaveBeenCalledWith('p1');
  });

  it('copies the public integration url', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);

    await userEvent.click(screen.getByTitle('Copy integration URL'));
    expect(screen.getByDisplayValue('http://localhost:3000/api/v1/playbooks/public/integration-token/execute')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/api/v1/playbooks/public/integration-token/execute');
    expect(toastMock.success).toHaveBeenCalledWith('Integration URL copied');
  });

  it('calls onSelect in selectable mode instead of navigating', async () => {
    const onSelect = vi.fn();
    navigateMock.mockClear();
    render(
      <PlaybookCard
        playbook={playbook}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        onToggleFavorite={vi.fn()}
        selectable
        selected={false}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByText('Deploy Pipeline'));
    expect(onSelect).toHaveBeenCalledWith('p1', true);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
