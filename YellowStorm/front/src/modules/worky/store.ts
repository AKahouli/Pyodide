/**
 * Worky Zustand store.
 *
 * Part 1: cached streams list (sidebar) + selected stream id.
 * Part 2: assistant message transcript (owner ↔ manager), live
 *   Kanban board state, pending clarifications, the most recent
 *   plan-delta summary, and an "undoable delta" overlay (the
 *   server already applied the delta, so the Undo button just
 *   clears the toast and refetches).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  WorkyBoardLane,
  WorkyBoardResponse,
  WorkyMessage,
  WorkyStream,
  WorkyStreamQueryParams,
  WorkyTask,
} from './types';

interface WorkyState {
  streams: WorkyStream[];
  streamsLoading: boolean;
  streamsError: string | null;
  selectedStreamId: string | null;
  setStreams: (streams: WorkyStream[]) => void;
  setStreamsLoading: (loading: boolean) => void;
  setStreamsError: (error: string | null) => void;
  setSelectedStreamId: (id: string | null) => void;
  upsertStream: (stream: WorkyStream) => void;
  reset: () => void;

  // --- Part 2 slices ---
  board: Record<WorkyBoardLane, WorkyTask[]> | null;
  boardLoading: boolean;
  boardError: string | null;
  setBoard: (board: WorkyBoardResponse | null) => void;
  setBoardLoading: (loading: boolean) => void;
  setBoardError: (error: string | null) => void;

  messages: WorkyMessage[];
  messagesLoading: boolean;
  setMessages: (messages: WorkyMessage[]) => void;
  appendMessage: (message: WorkyMessage) => void;
  markConfirmSubmitted: (questionId: string) => void;

  pendingClarifications: WorkyBoardResponse['pendingClarifications'];
  setPendingClarifications: (
    clarifications: WorkyBoardResponse['pendingClarifications'],
  ) => void;

  assistantText: string;
  appendAssistantToken: (text: string) => void;
  resetAssistantText: () => void;

  streaming: boolean;
  activeTurnId: string | null;
  beginTurn: (turnId: string) => void;
  finishTurn: (turnId: string) => void;
  setStreaming: (streaming: boolean) => void;

  lastPlanVersion: number | null;
  setLastPlanVersion: (v: number | null) => void;

  lastDeltaToast: { summary: string; at: number } | null;
  setLastDeltaToast: (toast: { summary: string; at: number } | null) => void;

  streamError: string | null;
  setStreamError: (error: string | null) => void;
}

const initialState = {
  streams: [] as WorkyStream[],
  streamsLoading: false,
  streamsError: null as string | null,
  selectedStreamId: null as string | null,
  board: null as Record<WorkyBoardLane, WorkyTask[]> | null,
  boardLoading: false,
  boardError: null as string | null,
  messages: [] as WorkyMessage[],
  messagesLoading: false,
  pendingClarifications: [] as WorkyBoardResponse['pendingClarifications'],
  assistantText: '',
  streaming: false,
  activeTurnId: null as string | null,
  lastPlanVersion: null as number | null,
  lastDeltaToast: null as { summary: string; at: number } | null,
  streamError: null as string | null,
};

export const useWorkyStore = create<WorkyState>()(
  devtools(
    (set) => ({
      ...initialState,
      setStreams: (streams) => set({ streams, streamsError: null }),
      setStreamsLoading: (streamsLoading) => set({ streamsLoading }),
      setStreamsError: (streamsError) => set({ streamsError }),
      setSelectedStreamId: (selectedStreamId) => set({ selectedStreamId }),
      upsertStream: (stream) =>
        set((state) => {
          const existing = state.streams.findIndex((s) => s.id === stream.id);
          if (existing === -1) {
            return { streams: [stream, ...state.streams] };
          }
          const next = state.streams.slice();
          next[existing] = stream;
          return { streams: next };
        }),
      setBoard: (board) => set({ board: board?.lanes ?? null, boardError: null }),
      setBoardLoading: (boardLoading) => set({ boardLoading }),
      setBoardError: (boardError) => set({ boardError }),
      // Dedup by id on replace. The messages React Query cache can transiently
      // hold the just-sent owner message twice (a racing refetch lands it, then
      // useSendMessage.onSuccess appends the same id again). This store is the
      // render source, so it must be duplicate-proof — keep the first occurrence
      // and preserve order. See useWorkyStore.appendMessage for the SSE path.
      setMessages: (messages) => {
        const seen = new Set<string>();
        const deduped = messages.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
        set((state) => ({
          messages: deduped,
          ...(state.activeTurnId &&
          deduped.some((m) => m.role === 'manager' && m.turnId === state.activeTurnId)
            ? { streaming: false, activeTurnId: null }
            : {}),
        }));
      },
      // Idempotent by id: the backend both returns the saved owner message
      // (which `useSendMessage` writes into the React Query cache, and the
      // messages effect mirrors into this store) and emits the same message
      // over SSE, so it would otherwise be appended twice until the next
      // refetch collapsed it. Also covers SSE replays after a reconnect.
      appendMessage: (message) =>
        set((state) => {
          if (state.messages.some((m) => m.id === message.id)) return {};
          const completesTurn =
            message.role === 'manager' &&
            typeof message.turnId === 'string' &&
            message.turnId === state.activeTurnId;
          return {
            messages: [...state.messages, message],
            ...(completesTurn ? { streaming: false, activeTurnId: null } : {}),
          };
        }),
      // Optimistically flip an answered confirm gate to 'submitted' so the card
      // leaves "Needs you" at once. The SSE path only APPENDS new messages — it
      // carries no component-status UPDATE on an existing message — so without
      // this the answered card lingers 'ready' until a full messages refetch.
      // A later setMessages refetch is consistent: the read model / Mongo already
      // hold it 'submitted'.
      markConfirmSubmitted: (questionId) =>
        set((state) => ({
          messages: state.messages.map((m) => {
            const hit = m.components?.some(
              (c) => (c.data as { questionId?: unknown } | undefined)?.questionId === questionId,
            );
            if (!hit) return m;
            return {
              ...m,
              components: m.components!.map((c) =>
                (c.data as { questionId?: unknown } | undefined)?.questionId === questionId
                  ? { ...c, data: { ...(c.data as Record<string, unknown>), status: 'submitted' } }
                  : c,
              ),
            };
          }),
        })),
      setPendingClarifications: (pendingClarifications) => set({ pendingClarifications }),
      appendAssistantToken: (text) =>
        set((state) => ({ assistantText: state.assistantText + text })),
      resetAssistantText: () => set({ assistantText: '' }),
      beginTurn: (activeTurnId) => set({ activeTurnId, streaming: true }),
      finishTurn: (turnId) =>
        set((state) =>
          state.activeTurnId === turnId ? { activeTurnId: null, streaming: false } : {},
        ),
      setStreaming: (streaming) =>
        set((state) => ({ streaming, activeTurnId: streaming ? state.activeTurnId : null })),
      setLastPlanVersion: (lastPlanVersion) => set({ lastPlanVersion }),
      setLastDeltaToast: (lastDeltaToast) => set({ lastDeltaToast }),
      setStreamError: (streamError) => set({ streamError }),
      reset: () => set(initialState),
    }),
    { name: 'worky-store' },
  ),
);

export function useWorkyStreams(): WorkyStream[] {
  return useWorkyStore((s) => s.streams);
}
export function useWorkyStreamsLoading(): boolean {
  return useWorkyStore((s) => s.streamsLoading);
}
export function useWorkySelectedStreamId(): string | null {
  return useWorkyStore((s) => s.selectedStreamId);
}
export function useWorkyBoard(): Record<WorkyBoardLane, WorkyTask[]> | null {
  return useWorkyStore((s) => s.board);
}
export function useWorkyBoardLoading(): boolean {
  return useWorkyStore((s) => s.boardLoading);
}
export function useWorkyBoardError(): string | null {
  return useWorkyStore((s) => s.boardError);
}
export function useWorkyMessages(): WorkyMessage[] {
  return useWorkyStore((s) => s.messages);
}
export function useWorkyAssistantText(): string {
  return useWorkyStore((s) => s.assistantText);
}
export function useWorkyStreaming(): boolean {
  return useWorkyStore((s) => s.streaming);
}
export function useWorkyPendingClarifications(): WorkyBoardResponse['pendingClarifications'] {
  return useWorkyStore((s) => s.pendingClarifications);
}
export function useWorkyLastDeltaToast(): { summary: string; at: number } | null {
  return useWorkyStore((s) => s.lastDeltaToast);
}

export type { WorkyStreamQueryParams };
