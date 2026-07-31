import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));
vi.mock('../../query/hooks', () => ({
  useStream: () => ({ data: { title: 'Q3 Market Expansion', status: 'active' } }),
  useStreamBudget: () => ({ data: { spendUsd: 42.8, limitUsd: 100 } }),
}));

import { WorkyTopBar } from './WorkyTopBar';

describe('WorkyTopBar', () => {
  it('shows the wordmark, stream switcher and budget', () => {
    render(<WorkyTopBar streamId="s1" />);
    expect(screen.getByText('Worky')).toBeTruthy();
    expect(screen.getByText('Q3 Market Expansion')).toBeTruthy();
    expect(screen.getByText('$42.80 / $100')).toBeTruthy();
  });
});
