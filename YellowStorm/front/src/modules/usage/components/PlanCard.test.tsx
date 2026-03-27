import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePlan } from '../test-utils';
import { PlanCard } from './PlanCard';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('PlanCard', () => {
  it('renders current plan badge and disables current action', () => {
    render(<PlanCard plan={makePlan({ slug: 'free', name: 'Free' })} isCurrentPlan onSelect={vi.fn()} />);
    expect(screen.getByText('usage.upgrade.badges.current')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'usage.upgrade.actions.current' })).toBeDisabled();
  });

  it('formats values and calls onSelect for non-current plans', async () => {
    const onSelect = vi.fn();
    const plan = makePlan({
      id: 'p2',
      slug: 'enterprise',
      name: 'Enterprise',
      priceMonthly: 29,
      priceYearly: 299,
      tokenLimit: 1500000,
      requestsPerMinute: -1,
      workspaceStorageBytes: -1,
      features: ['api_access', 'unknown_feature'],
    });

    render(<PlanCard plan={plan} isCurrentPlan={false} onSelect={onSelect} />);
    expect(screen.getByText('usage.upgrade.badges.popular')).toBeInTheDocument();
    expect(screen.getByText('usage.upgrade.features.labels.apiAccess')).toBeInTheDocument();
    expect(screen.getByText('unknown_feature')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'usage.upgrade.actions.upgrade' }));
    expect(onSelect).toHaveBeenCalledWith(plan);
  });
});
