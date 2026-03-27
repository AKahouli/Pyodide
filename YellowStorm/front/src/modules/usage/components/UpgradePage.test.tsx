import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makePlan } from '../test-utils';
import { UpgradePage } from './UpgradePage';

const usageState = vi.hoisted(() => ({
  plans: [] as ReturnType<typeof makePlan>[],
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { plan: { slug: 'basic' } } }),
}));

vi.mock('../UsageContext', () => ({
  useUsage: () => usageState,
}));

vi.mock('./UpgradeHeader', () => ({
  UpgradeHeader: ({ onBack }: { onBack: () => void }) => <button type='button' onClick={onBack}>back</button>,
}));

vi.mock('./PlanCard', () => ({
  PlanCard: ({ plan, isCurrentPlan }: { plan: { slug: string }; isCurrentPlan: boolean }) => (
    <div>
      <span>plan-{plan.slug}</span>
      <span>current-{String(isCurrentPlan)}</span>
    </div>
  ),
}));

describe('UpgradePage', () => {
  it('shows loading skeleton when no plans are available', () => {
    usageState.plans = [];
    const { container } = render(
      <MemoryRouter initialEntries={['/upgrade']}>
        <Routes>
          <Route path='/upgrade' element={<UpgradePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('sorts plans by displayOrder and marks current plan', () => {
    usageState.plans = [
      makePlan({ id: 'p1', slug: 'enterprise', displayOrder: 3 }),
      makePlan({ id: 'p2', slug: 'free', displayOrder: 1 }),
      makePlan({ id: 'p3', slug: 'basic', displayOrder: 2 }),
    ];

    render(
      <MemoryRouter initialEntries={['/upgrade']}>
        <Routes>
          <Route path='/upgrade' element={<UpgradePage />} />
        </Routes>
      </MemoryRouter>,
    );
    const planLabels = screen.getAllByText(/plan-/).map((el) => el.textContent);
    expect(planLabels).toEqual(['plan-free', 'plan-basic', 'plan-enterprise']);
    expect(screen.getByText('current-true')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'back' })).toBeInTheDocument();
  });
});
