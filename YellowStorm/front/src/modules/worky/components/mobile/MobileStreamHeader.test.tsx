import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'agents.team.count') return `${opts?.count} agents`;
      if (k === 'badges.status.active') return 'Active';
      return k;
    },
    language: 'en',
    ready: true,
  }),
}));

vi.mock('../../query/hooks', () => ({
  useStream: () => ({ data: { title: 'Q3 Market Expansion', status: 'active' } }),
  // Consumed by useStopSession (stop button in the mobile header).
  useStopTurn: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../agents/useStreamAgents', () => ({
  useStreamAgents: () => ({ agents: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }], ungrouped: [] }),
}));

import { MobileStreamHeader } from './MobileStreamHeader';

describe('MobileStreamHeader', () => {
  it('shows the stream title and an "N agents · Status" subtitle', () => {
    render(<MobileStreamHeader streamId="s1" onBack={() => {}} onOpenChat={() => {}} />);
    expect(screen.getByText('Q3 Market Expansion')).toBeTruthy();
    expect(screen.getByText('4 agents · Active')).toBeTruthy();
  });

  it('wires back and chat actions', async () => {
    const onBack = vi.fn();
    const onOpenChat = vi.fn();
    render(<MobileStreamHeader streamId="s1" onBack={onBack} onOpenChat={onOpenChat} />);
    await userEvent.click(screen.getByLabelText('header.back'));
    await userEvent.click(screen.getByLabelText('orchestrator.tabs.chat'));
    expect(onBack).toHaveBeenCalled();
    expect(onOpenChat).toHaveBeenCalled();
  });
});
