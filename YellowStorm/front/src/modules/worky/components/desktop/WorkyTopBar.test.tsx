import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));
vi.mock('../../query/hooks', () => ({
  useStream: () => ({ data: { title: 'Q3 Market Expansion', status: 'active' } }),
  useStreams: () => ({
    data: {
      data: [
        { id: 's1', title: 'Q3 Market Expansion' },
        { id: 's2', title: 'Hiring' },
      ],
      meta: { total: 2, page: 1, limit: 100, totalPages: 1, statusCounts: {} },
    },
  }),
  useCreateStream: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // Consumed by useStopSession (stop button in the top bar).
  useStopTurn: () => ({ mutate: vi.fn(), isPending: false }),
  usePauseTurn: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeTurn: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { WorkyTopBar } from './WorkyTopBar';

const renderTopBar = () =>
  render(
    <MemoryRouter>
      <WorkyTopBar streamId="s1" />
    </MemoryRouter>,
  );

describe('WorkyTopBar', () => {
  it('shows the wordmark and the current stream', () => {
    renderTopBar();
    expect(screen.getByText('Worky')).toBeTruthy();
    expect(screen.getByText('Q3 Market Expansion')).toBeTruthy();
  });

  it('does not duplicate search, budget, notifications or profile', () => {
    renderTopBar();
    expect(screen.queryByText('dashboard.searchPlaceholder')).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByLabelText('nav.worky')).toBeNull();
  });

  it('opens the create dialog from the plus button', async () => {
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByTestId('worky-topbar-new-stream'));

    expect(await screen.findByPlaceholderText('dashboard.newStreamPlaceholder')).toBeTruthy();
  });

  it('navigates to another stream from the switcher', async () => {
    // Radix opens the menu on pointerdown, which fireEvent.click does not emit.
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByTestId('worky-stream-switcher'));
    await user.click(await screen.findByText('Hiring'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/worky/s2'));
  });
});
