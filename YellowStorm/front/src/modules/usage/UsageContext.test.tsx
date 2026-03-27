import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageProvider, useUsage } from './UsageContext';
import { makePlan, makeUsageStatus } from './test-utils';

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  user: null as null | { id: string },
}));

const apiFns = vi.hoisted(() => ({
  getUsageStatus: vi.fn(),
  getPlans: vi.fn(),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => authState,
}));

vi.mock('./api', () => apiFns);

function Consumer() {
  const { status, plans, isLoading, error, refreshUsage } = useUsage();
  return (
    <div>
      <span>loading:{String(isLoading)}</span>
      <span>status:{status ? 'yes' : 'no'}</span>
      <span>plans:{plans.length}</span>
      <span>error:{error ?? 'none'}</span>
      <button type='button' onClick={() => refreshUsage()}>refresh</button>
    </div>
  );
}

function renderWithinProvider() {
  return render(
    <UsageProvider>
      <Consumer />
    </UsageProvider>,
  );
}

describe('UsageContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = false;
    authState.user = null;
    apiFns.getUsageStatus.mockResolvedValue(makeUsageStatus());
    apiFns.getPlans.mockResolvedValue([makePlan()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when useUsage is used outside provider', () => {
    expect(() => render(<Consumer />)).toThrow('useUsage must be used within a UsageProvider');
  });

  it('fetches status and plans when authenticated', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1' };

    renderWithinProvider();

    await waitFor(() => expect(apiFns.getUsageStatus).toHaveBeenCalled());
    expect(apiFns.getPlans).toHaveBeenCalled();
    expect(screen.getByText('status:yes')).toBeInTheDocument();
    expect(screen.getByText('plans:1')).toBeInTheDocument();
  });

  it('handles usage status fetch errors and exposes error message', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1' };
    apiFns.getUsageStatus.mockRejectedValueOnce(new Error('boom'));

    renderWithinProvider();

    await waitFor(() => expect(screen.getByText('error:boom')).toBeInTheDocument());
  });

  it('refreshUsage triggers status and plans fetches', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1' };

    renderWithinProvider();

    await waitFor(() => expect(apiFns.getUsageStatus).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(apiFns.getUsageStatus).toHaveBeenCalledTimes(2));
    expect(apiFns.getPlans).toHaveBeenCalledTimes(2);
  });

  it('refreshes usage status on 5 minute interval when authenticated', async () => {
    authState.isAuthenticated = true;
    authState.user = { id: 'u1' };
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderWithinProvider();
    await waitFor(() => expect(apiFns.getUsageStatus).toHaveBeenCalledTimes(1));

    const intervalCallback = setIntervalSpy.mock.calls[0][0] as () => void;
    await intervalCallback();
    await waitFor(() => expect(apiFns.getUsageStatus).toHaveBeenCalledTimes(2));
  });
});
