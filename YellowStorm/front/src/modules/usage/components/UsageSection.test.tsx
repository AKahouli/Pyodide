import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUsageStatus } from '../test-utils';
import { UsageSection } from './UsageSection';

const refreshUsageMock = vi.hoisted(() => vi.fn(async () => undefined));
const closeSettingsMock = vi.hoisted(() => vi.fn());
const usageState = vi.hoisted(() => ({
  status: null as ReturnType<typeof makeUsageStatus> | null,
  isLoading: false,
  refreshUsage: refreshUsageMock,
}));

vi.mock('../UsageContext', () => ({
  useUsage: () => usageState,
}));

vi.mock('@/modules/profile', () => ({
  useSettingsModal: () => ({ closeSettings: closeSettingsMock }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

describe('UsageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageState.status = null;
    usageState.isLoading = false;
  });

  it('shows loading skeleton and no-data retry states', async () => {
    usageState.isLoading = true;
    const { rerender, container } = render(<UsageSection />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();

    usageState.isLoading = false;
    rerender(<UsageSection />);
    expect(screen.getByText('usage.loadError')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'usage.actions.retry' }));
    expect(refreshUsageMock).toHaveBeenCalled();
  });

  it('renders usage details and handles refresh and upgrade action', async () => {
    usageState.status = makeUsageStatus({ isLimitExceeded: true });
    render(<UsageSection />);

    expect(screen.getByText('usage.plan.title')).toBeInTheDocument();
    expect(screen.getByText('usage.tokens.title')).toBeInTheDocument();
    expect(screen.getByText('usage.window.title')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'usage.actions.refresh' }));
    await waitFor(() => expect(refreshUsageMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'usage.plan.upgrade' }));
    expect(closeSettingsMock).toHaveBeenCalled();
  });
});
