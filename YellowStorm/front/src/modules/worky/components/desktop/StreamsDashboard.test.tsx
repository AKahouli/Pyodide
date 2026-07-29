import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

const q = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('../../query/hooks', () => ({ useStreams: () => ({ data: q.data }) }));

import { StreamsDashboard } from './StreamsDashboard';

beforeEach(() => {
  q.data = [
    { id: '1', title: 'Q3 Expansion', status: 'active', currentPlanVersion: 3 },
    { id: '2', title: 'Hiring', status: 'waiting_for_owner', currentPlanVersion: 1 },
    { id: '3', title: 'Revamp', status: 'active', currentPlanVersion: 2 },
  ];
});

describe('StreamsDashboard', () => {
  it('renders derivable KPIs and a card per stream', () => {
    render(
      <MemoryRouter>
        <StreamsDashboard />
      </MemoryRouter>,
    );
    expect(screen.getByText('Q3 Expansion')).toBeTruthy();
    expect(screen.getByText('Hiring')).toBeTruthy();
    expect(screen.getByText('Revamp')).toBeTruthy();
    // Active KPI = 2 of the 3 streams.
    const active = screen.getByTestId('kpi-active');
    expect(active.textContent).toContain('2');
    const total = screen.getByTestId('kpi-total');
    expect(total.textContent).toContain('3');
  });
});
