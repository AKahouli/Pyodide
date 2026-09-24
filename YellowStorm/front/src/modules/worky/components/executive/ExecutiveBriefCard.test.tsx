import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExecutiveBriefCard } from './ExecutiveBriefCard';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const model = {
  plan: { title: 'Mission', goal: 'A long mission goal' },
  health: 'at_risk',
  summary: { completed: 10, total: 22, remaining: 12, active: 0, blocked: 3, waitingExternal: 0, needsInput: 0 },
} as WorkyExecutiveViewModel;

describe('ExecutiveBriefCard', () => {
  it('keeps useful progress and risk metrics without active or external-wait tiles', () => {
    render(<ExecutiveBriefCard model={model} />);
    expect(screen.getByText('executive.brief.complete')).toBeInTheDocument();
    expect(screen.getByText('executive.brief.remaining')).toBeInTheDocument();
    expect(screen.getByText('executive.brief.blocked')).toBeInTheDocument();
    expect(screen.queryByText('executive.brief.active')).not.toBeInTheDocument();
    expect(screen.queryByText('executive.brief.waiting')).not.toBeInTheDocument();
  });

  it('lets a reader expand a compact goal', async () => {
    render(<ExecutiveBriefCard model={model} />);
    const button = screen.getByRole('button', { name: 'executive.brief.expandGoal' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'executive.brief.collapseGoal' })).toHaveAttribute('aria-expanded', 'true');
  });
});
