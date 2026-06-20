import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/modules/auth';
import type { AuthContextType } from '@/modules/auth';
import { LocalizationProvider } from '@/modules/localization';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { KanbanBoard } from './KanbanBoard';
import { useWorkyStore } from '../store';
import { useBoard } from '../query/hooks';
import type { WorkyBoardResponse } from '../types';

vi.mock('../query/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../query/hooks')>();
  return { ...actual, useBoard: vi.fn() };
});

const authValue: AuthContextType = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'user-1', email: 'user-1@example.com' } as AuthContextType['user'],
  requiresEmailVerification: false,
  requiresProfileCompletion: false,
  registrationEnabled: true,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  completeProfile: vi.fn(),
  refreshUser: vi.fn(),
};

function TestProviders({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LocalizationProvider>
            <ThemeProvider defaultTheme='light'>{children}</ThemeProvider>
          </LocalizationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

const baseTask = {
  streamId: 'stream-1',
  description: '',
  planningStatus: 'confirmed' as const,
  executionState: 'not_started',
  priority: 'medium' as const,
  assigneeType: 'unassigned' as const,
  assigneeId: null,
  actionCategory: 'internal_analysis' as const,
  dependsOn: [],
  blockerReason: null,
  theoreticalDeadlineAt: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
};

describe('KanbanBoard reconciles when useBoard returns new data', () => {
  beforeEach(() => {
    useWorkyStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    useWorkyStore.getState().reset();
  });

  it('renders the initial board and updates when a new task appears (SSE-driven invalidation path)', () => {
    const initialBoard: WorkyBoardResponse = {
      streamId: 'stream-1',
      lanes: {
        backlog: [],
        ready: [{ ...baseTask, id: 'task-1', title: 'First task', lane: 'ready' }],
        running: [],
        review: [],
        blocked: [],
        done: [],
      },
      pendingClarifications: [],
    };
    const updatedBoard: WorkyBoardResponse = {
      ...initialBoard,
      lanes: {
        ...initialBoard.lanes,
        ready: [
          ...initialBoard.lanes.ready,
          { ...baseTask, id: 'task-2', title: 'Second task (just added)', lane: 'ready', priority: 'high' },
        ],
      },
    };
    (useBoard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: initialBoard,
      isLoading: false,
      error: null,
      refetch: () => Promise.resolve({ data: initialBoard }),
    });

    // `WorkyStreamPage` copies `useBoard().data` into the Zustand
    // store via the `setBoard` action. The board component reads
    // from the store, so the test seeds the store directly and
    // asserts the component reflects the new shape after the SSE
    // handler would have invalidated the query.
    useWorkyStore.getState().setBoard(initialBoard);

    const { rerender } = render(
      <TestProviders>
        <KanbanBoard />
      </TestProviders>,
    );
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.queryByText('Second task (just added)')).not.toBeInTheDocument();

    // Simulate the SSE handler invalidating the board query and
    // `WorkyStreamPage` pushing the new board into the store.
    useWorkyStore.getState().setBoard(updatedBoard);
    rerender(
      <TestProviders>
        <KanbanBoard />
      </TestProviders>,
    );
    expect(screen.getByText('Second task (just added)')).toBeInTheDocument();
  });
});
