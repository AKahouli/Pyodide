import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));
vi.mock('../../query/hooks', () => ({
  useStreamBudget: () => ({ data: { spendUsd: 42.8, limitUsd: 100 } }),
}));

import { WorkyActivityRail } from './WorkyActivityRail';
import { useWorkyUiStore } from '../../uiStore';

beforeEach(() => useWorkyUiStore.getState().reset());

describe('WorkyActivityRail', () => {
  it('renders the budget mini and live activity items', () => {
    useWorkyUiStore.getState().pushActivity({ key: 'a1', icon: 'check', tone: 'working', text: 'A task was completed' });
    render(<WorkyActivityRail streamId="s1" />);
    expect(screen.getByText('$42.80 / $100')).toBeTruthy();
    expect(screen.getByText('A task was completed')).toBeTruthy();
  });

  it('shows an empty state when there is no activity', () => {
    render(<WorkyActivityRail streamId="s1" />);
    expect(screen.getByText('activity.empty')).toBeTruthy();
  });
});
