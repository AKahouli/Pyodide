import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/modules/auth';
import type { AuthContextType } from '@/modules/auth';
import { LocalizationProvider } from '@/modules/localization';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { KanbanBoard } from './KanbanBoard';
import { useWorkyStore } from '../store';
import { useBoard, useTaskOps } from '../query/hooks';
import type { WorkyBoardResponse } from '../types';

vi.mock('../query/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../query/hooks')>();
  return { ...actual, useBoard: vi.fn(), useTaskOps: vi.fn() };
});

const moveTask = vi.fn();

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
    (useTaskOps as ReturnType<typeof vi.fn>).mockReturnValue({
      move: { mutate: moveTask, isPending: false },
    });
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
        <KanbanBoard streamId='stream-1' />
      </TestProviders>,
    );
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.queryByText('Second task (just added)')).not.toBeInTheDocument();

    // Simulate the SSE handler invalidating the board query and
    // `WorkyStreamPage` pushing the new board into the store.
    useWorkyStore.getState().setBoard(updatedBoard);
    rerender(
      <TestProviders>
        <KanbanBoard streamId='stream-1' />
      </TestProviders>,
    );
    expect(screen.getByText('Second task (just added)')).toBeInTheDocument();
  });

  it('marks empty lanes as compact via the data-empty attribute', () => {
    const board: WorkyBoardResponse = {
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
    (useBoard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: board,
      isLoading: false,
      error: null,
      refetch: () => Promise.resolve({ data: board }),
    });
    useWorkyStore.getState().setBoard(board);

    render(
      <TestProviders>
        <KanbanBoard streamId='stream-1' />
      </TestProviders>,
    );

    const runningLane = screen.getByTestId('worky-lane-running');
    expect(runningLane.getAttribute('data-empty')).toBe('true');

    const readyLane = screen.getByTestId('worky-lane-ready');
    expect(readyLane.getAttribute('data-empty')).toBe('false');
  });

  it('moves a dragged task card into any visible lane', async () => {
    const board: WorkyBoardResponse = {
      streamId: 'stream-1',
      lanes: {
        backlog: [],
        ready: [{ ...baseTask, id: 'task-1', title: 'Move me', lane: 'ready' }],
        running: [],
        review: [],
        blocked: [],
        done: [],
      },
      pendingClarifications: [],
    };
    (useBoard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: board,
      isLoading: false,
      error: null,
      refetch: () => Promise.resolve({ data: board }),
    });
    useWorkyStore.getState().setBoard(board);

    render(
      <TestProviders>
        <KanbanBoard streamId='stream-1' />
      </TestProviders>,
    );

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByText('Move me').closest('button')!, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('worky-lane-done'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('worky-lane-done'), { dataTransfer });

    await waitFor(() => {
      expect(moveTask).toHaveBeenCalledWith({
        taskId: 'task-1',
        lane: 'done',
        reason: 'owner-kanban-move',
      });
    });
  });
});

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    clearData: (type?: string) => {
      if (type) data.delete(type);
      else data.clear();
    },
  } as unknown as DataTransfer;
}
