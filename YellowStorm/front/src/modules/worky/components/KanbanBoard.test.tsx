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
import { useStreamAgents } from '../agents/useStreamAgents';
import type { WorkyBoardResponse } from '../types';

vi.mock('../query/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../query/hooks')>();
  return { ...actual, useBoard: vi.fn(), useTaskOps: vi.fn() };
});

vi.mock('../agents/useStreamAgents', () => ({ useStreamAgents: vi.fn() }));

const moveTask = vi.fn();

const authValue: AuthContextType = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: 'user-1', email: 'user-1@example.com' } as AuthContextType['user'],
  requiresEmailVerification: false,
  requiresProfileCompletion: false,
  registrationEnabled: true,
  isAuthTemporarilyUnavailable: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  completeProfile: vi.fn(),
  refreshUser: vi.fn(),
  retryRecovery: vi.fn(),
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
  externalId: null,
  description: '',
  planningStatus: 'confirmed' as const,
  executionState: 'not_started',
  priority: 'medium' as const,
  assigneeType: 'unassigned' as const,
  assigneeId: null,
  actionCategory: 'internal_analysis' as const,
  dependsOn: [],
  wave: null,
  dependsOnStepIds: [],
  blockerReason: null,
  result: null,
  blockedReason: null,
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
    (useStreamAgents as ReturnType<typeof vi.fn>).mockReturnValue({ agents: [], ungrouped: [] });
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
        failed: [],
        blocked: [],
        done: [],
        canceled: [],
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
        failed: [],
        blocked: [],
        done: [],
        canceled: [],
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

    // 'ready' tasks are aggregated into the orchestrator 'pending' column.
    const pendingLane = screen.getByTestId('worky-lane-pending');
    expect(pendingLane.getAttribute('data-empty')).toBe('false');
  });

  it('moves a dragged task card into any visible lane', async () => {
    const board: WorkyBoardResponse = {
      streamId: 'stream-1',
      lanes: {
        backlog: [],
        ready: [{ ...baseTask, id: 'task-1', title: 'Move me', lane: 'ready' }],
        running: [],
        review: [],
        failed: [],
        blocked: [],
        done: [],
        canceled: [],
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
    // Drop onto the orchestrator 'completed' column → legacy 'done' lane move.
    fireEvent.dragOver(screen.getByTestId('worky-lane-completed'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('worky-lane-completed'), { dataTransfer });

    await waitFor(() => {
      expect(moveTask).toHaveBeenCalledWith({
        taskId: 'task-1',
        lane: 'done',
        reason: 'owner-kanban-move',
      });
    });
  });

  it('shows the resolved assignee name on status cards, with raw-key and type-label fallbacks', () => {
    const board: WorkyBoardResponse = {
      streamId: 'stream-1',
      lanes: {
        backlog: [],
        ready: [
          {
            ...baseTask,
            id: 'task-1',
            title: 'Resolved task',
            lane: 'ready',
            assigneeType: 'ephemeral_ai_agent' as const,
            assigneeKey: 'agent-1',
          },
          {
            ...baseTask,
            id: 'task-2',
            title: 'Unresolved task',
            lane: 'ready',
            assigneeType: 'ephemeral_ai_agent' as const,
            assigneeKey: 'deadbeef',
          },
          { ...baseTask, id: 'task-3', title: 'Unattributed task', lane: 'ready' },
          {
            ...baseTask,
            id: 'task-4',
            title: 'Persona task',
            lane: 'ready',
            assigneeType: 'human_agent' as const,
            assigneeName: 'Aziza',
            isPersona: true,
          },
        ],
        running: [],
        review: [],
        failed: [],
        blocked: [],
        done: [],
        canceled: [],
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
    (useStreamAgents as ReturnType<typeof vi.fn>).mockReturnValue({
      agents: [{ key: 'agent-1', name: 'Atlas' }],
      ungrouped: [],
    });

    render(
      <TestProviders>
        <KanbanBoard streamId='stream-1' />
      </TestProviders>,
    );

    // Resolved assignee key renders the agent's display name.
    expect(screen.getByText('Atlas')).toBeInTheDocument();
    // Unresolved key falls back to the raw key (same rule as the graph view).
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
    // Unattributed task keeps the assignee-type label (i18n mock returns the key).
    expect(screen.getByText('kanban.assignees.unassigned')).toBeInTheDocument();
    // Persona step (assigneeName set, assigneeKey null) shows the human's name,
    // not the generic type label — the fix for personas hidden on the board.
    expect(screen.getByText('Aziza')).toBeInTheDocument();
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
