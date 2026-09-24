import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PaginatedStreams, WorkyStreamListItem } from '../../types';

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
  envelope: undefined as unknown,
  params: {} as Record<string, unknown>,
  isLoading: false,
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../query/hooks', () => ({
  useStreams: (params: Record<string, unknown> = {}) => {
    q.params = params;
    return { data: q.envelope, isLoading: q.isLoading };
  },
  useCreateStream: () => ({ mutateAsync: q.create, isPending: false }),
  useDeleteStream: () => ({ mutateAsync: q.remove, isPending: false }),
  useBoard: () => ({ data: undefined }),
}));

import { StreamsDashboard } from './StreamsDashboard';

const makeStream = (over: Partial<WorkyStreamListItem>): WorkyStreamListItem => ({
  id: 'x',
  ownerUserId: 'u',
  access: 'owner',
  workspaceId: 'w',
  artifactWorkspaceId: null,
  managerAgentId: null,
  managerModelId: null,
  workerModelId: null,
  governancePolicyRef: null,
  title: 'Untitled',
  status: 'active',
  controlState: 'active',
  schedulerEnabled: false,
  currentPlanVersion: 1,
  executionPlanVersion: null,
  budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  startedAt: null,
  completedAt: null,
  activeDurationMinutes: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastActivityAt: '2026-01-01T00:00:00Z',
  stats: { totalTasks: 0, running: 0, done: 0, blocked: 0, failed: 0, progress: 0 },
  ...over,
});

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <StreamsDashboard />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  q.params = {};
  q.isLoading = false;
  const envelope: PaginatedStreams = {
    data: [
      makeStream({ id: '1', title: 'Q3 Expansion', status: 'active' }),
      makeStream({ id: '2', title: 'Hiring', status: 'waiting_for_owner' }),
      makeStream({ id: '3', title: 'Revamp', status: 'active' }),
    ],
    meta: {
      total: 3,
      page: 1,
      limit: 12,
      totalPages: 3,
      statusCounts: { active: 2, waiting_for_owner: 1, completed: 1 },
      attentionCount: 2,
    },
  };
  q.envelope = envelope;
});

describe('StreamsDashboard', () => {
  it('renders a card per stream and a portfolio attention summary', () => {
    renderDashboard();
    expect(screen.getByText('Q3 Expansion')).toBeTruthy();
    expect(screen.getByText('Hiring')).toBeTruthy();
    expect(screen.getByText('Revamp')).toBeTruthy();
    // active group = active(2); attention group = waiting_for_owner(1); total = all counts (4)
    expect(screen.getByText('command.portfolio.summary')).toBeTruthy();
  });

  it('passes the debounced search term to the streams query', async () => {
    renderDashboard();
    fireEvent.change(screen.getByPlaceholderText('dashboard.searchPlaceholder'), {
      target: { value: 'hiring' },
    });
    await waitFor(() => expect(q.params.search).toBe('hiring'));
  });

  it('filters by status group when a chip is clicked', async () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId('chip-active'));
    await waitFor(() => expect(q.params.status).toEqual(expect.arrayContaining(['active'])));
  });

  it('uses the task-aware attention filter and count', async () => {
    renderDashboard();
    expect(screen.getByTestId('chip-attention')).toHaveTextContent('(2)');
    fireEvent.click(screen.getByTestId('chip-attention'));
    await waitFor(() => expect(q.params).toMatchObject({ attention: true, status: undefined }));
  });

  it('advances the page with the Next control', async () => {
    renderDashboard();
    expect(screen.getByTestId('pagination-summary')).toBeTruthy();
    fireEvent.click(screen.getByTestId ? screen.getByTestId('pagination-next') : screen.getByText('Next'));
    await waitFor(() => expect(q.params.page).toBe(2));
  });

  it('passes a created-from date filter to the query', async () => {
    renderDashboard();
    fireEvent.change(screen.getByTestId('filter-created-from'), {
      target: { value: '2026-01-15' },
    });
    await waitFor(() => expect(q.params.createdFrom).toBe('2026-01-15'));
  });

  it('deletes a stream from its card once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    q.remove.mockResolvedValue(undefined);
    renderDashboard();
    fireEvent.click(screen.getAllByLabelText('dashboard.deleteStream')[0]);
    await waitFor(() => expect(q.remove).toHaveBeenCalledWith('1'));
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

  it('shows the empty state when there are no streams', () => {
    q.envelope = {
      data: [],
      meta: { total: 0, page: 1, limit: 12, totalPages: 0, statusCounts: {}, attentionCount: 0 },
    };
    renderDashboard();
    expect(screen.getByText('dashboard.empty')).toBeTruthy();
  });
});
