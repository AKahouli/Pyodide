import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeUsageStatus } from '../test-utils';
import { UsageLimitBanner } from './UsageLimitBanner';

const navigateMock = vi.hoisted(() => vi.fn());
const usageState = vi.hoisted(() => ({
  status: null as ReturnType<typeof makeUsageStatus> | null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../UsageContext', () => ({
  useUsage: () => usageState,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en-US' }),
}));

describe('UsageLimitBanner', () => {
  it('returns null when limit is not exceeded', () => {
    usageState.status = makeUsageStatus({ isLimitExceeded: false });
    const { container } = render(<UsageLimitBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner and navigates to upgrade', async () => {
    usageState.status = makeUsageStatus({ isLimitExceeded: true });
    render(<UsageLimitBanner />);

    expect(screen.getByText('usage.banner.limitReached')).toBeInTheDocument();
    expect(screen.getByText('usage.banner.resetsOn')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'usage.banner.upgradeCta' }));
    expect(navigateMock).toHaveBeenCalledWith('/upgrade');
  });
});
