import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookCard } from './PlaybookCard';
import type { PlaybookSummary } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const playbook: PlaybookSummary = {
  id: 'p1',
  name: 'Deploy Pipeline',
  description: 'Automated deployment',
  taskCount: 5,
  isFavorite: false,
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

  it('navigates to playbook on card click', async () => {
    render(<PlaybookCard playbook={playbook} onDelete={vi.fn()} onClone={vi.fn()} onToggleFavorite={vi.fn()} />);
    await userEvent.click(screen.getByText('Deploy Pipeline'));
    expect(navigateMock).toHaveBeenCalledWith('/playbooks/p1');
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
