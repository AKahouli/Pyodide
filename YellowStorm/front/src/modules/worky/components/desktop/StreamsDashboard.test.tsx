import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const q = vi.hoisted(() => ({
  data: [] as unknown[],
  search: undefined as string | undefined,
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../query/hooks', () => ({
  useStreams: (params: { search?: string } = {}) => {
    q.search = params.search;
    return { data: q.data, isLoading: false };
  },
  useCreateStream: () => ({ mutateAsync: q.create, isPending: false }),
  useDeleteStream: () => ({ mutateAsync: q.remove, isPending: false }),
}));

import { StreamsDashboard } from './StreamsDashboard';

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <StreamsDashboard />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  q.search = undefined;
  q.data = [
    { id: '1', title: 'Q3 Expansion', status: 'active', currentPlanVersion: 3 },
    { id: '2', title: 'Hiring', status: 'waiting_for_owner', currentPlanVersion: 1 },
    { id: '3', title: 'Revamp', status: 'active', currentPlanVersion: 2 },
  ];
});

describe('StreamsDashboard', () => {
  it('renders derivable KPIs and a card per stream', () => {
    renderDashboard();
    expect(screen.getByText('Q3 Expansion')).toBeTruthy();
    expect(screen.getByText('Hiring')).toBeTruthy();
    expect(screen.getByText('Revamp')).toBeTruthy();
    // Active KPI = 2 of the 3 streams.
    const active = screen.getByTestId('kpi-active');
    expect(active.textContent).toContain('2');
    const total = screen.getByTestId('kpi-total');
    expect(total.textContent).toContain('3');
  });

  it('passes the typed search term to the streams query', () => {
    renderDashboard();
    fireEvent.change(screen.getByPlaceholderText('dashboard.searchPlaceholder'), {
      target: { value: 'hiring' },
    });
    expect(q.search).toBe('hiring');
  });

  it('creates a stream from the dialog and navigates to it', async () => {
    q.create.mockResolvedValue({ id: 'new-1' });
    renderDashboard();

    fireEvent.click(screen.getByTestId('worky-new-stream'));
    fireEvent.change(screen.getByPlaceholderText('dashboard.newStreamPlaceholder'), {
      target: { value: 'Launch plan' },
    });
    fireEvent.click(screen.getByText('actions.create'));

    await waitFor(() => expect(q.create).toHaveBeenCalledWith({ title: 'Launch plan' }));
    expect(navigate).toHaveBeenCalledWith('/worky/new-1');
  });

  it('deletes a stream from its card once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    q.remove.mockResolvedValue(undefined);
    renderDashboard();

    fireEvent.click(screen.getAllByLabelText('dashboard.deleteStream')[0]);

    await waitFor(() => expect(q.remove).toHaveBeenCalledWith('1'));
  });

  it('does not delete when the confirm is dismissed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDashboard();

    fireEvent.click(screen.getAllByLabelText('dashboard.deleteStream')[0]);

    expect(q.remove).not.toHaveBeenCalled();
  });
});
