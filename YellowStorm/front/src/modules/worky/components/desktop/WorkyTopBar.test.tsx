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

vi.mock('../../query/hooks', () => ({
  useStream: () => ({ data: { title: 'Q3 Market Expansion', status: 'active' } }),
  useStreams: () => ({
    data: [
      { id: 's1', title: 'Q3 Market Expansion' },
      { id: 's2', title: 'Hiring' },
    ],
  }),
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

  it('navigates to another stream from the switcher', async () => {
    // Radix opens the menu on pointerdown, which fireEvent.click does not emit.
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByTestId('worky-stream-switcher'));
    await user.click(await screen.findByText('Hiring'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/worky/s2'));
  });
});
