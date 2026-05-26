import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AgentEvent, ConversationV2PointerSummary } from './types';
import { conversationV2Api } from './api';
import {
  readSelectedModelForSession,
  writeSelectedModelForSession,
} from './selectedModelStorage';

interface State {
  sessionId: string | null;
  title: string | null;
  events: AgentEvent[];
  streaming: boolean;
  streamError: string | null;
  rightPanelMode: 'closed' | 'tool';
  /** Files-in-this-conversation sheet open state. Independent of the right
   *  panel so the user can keep the tool detail open while browsing files. */
  filesSheetOpen: boolean;
  systemWorkspaceId: string | null;
  /** workspaceIds attached to this session (read-only here; set on session load). */
  workspaceIds: string[];
  selectedToolCallId: string | null;
  /** Latest non-message tool emitted by the agent — the "live" target the panel follows. */
  liveToolCallId: string | null;
  /** event_ids of assistant messages that arrived live (not from replay) — drives typewriter. */
  liveAssistantIds: Set<string>;
  /** Drives the header typewriter animation when a freshly-generated title lands live. */
  typewriterSessionId: string | null;
  typewriterName: string | null;
  /**
   * User-picked model for this conversation. `null` means "use the admin
   * default" — the UI shows the default model, the composer sends no `model`
   * field on the wire, and the AI service falls back to its own default.
   * Persisted to localStorage per sessionId (see selectedModelStorage).
   */
  selectedModelId: string | null;
  /** Highest sequence number seen from live SSE events. Used to discard stale/duplicate events. */
  lastSequence: number;
}

interface Actions {
  setSessionId: (id: string | null) => void;
  setStreaming: (s: boolean) => void;
  handleEvent: (event: AgentEvent) => void;
  replayEvents: (events: AgentEvent[]) => void;
  reset: () => void;
  openToolPanel: (toolCallId: string) => void;
  jumpToLive: () => void;
  closeRightPanel: () => void;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /**
   * Set the per-conversation model. Persists to localStorage keyed by the
   * current sessionId so the choice survives reloads and re-navigation. Pass
   * `null` to clear and fall back to the admin default.
   */
  setSystemWorkspaceId: (id: string | null) => void;
  setFilesSheetOpen: (open: boolean) => void;
  setSelectedModelId: (modelId: string | null) => void;
  /**
   * Read the per-conversation model from localStorage for the given session
   * and apply it to the store. Called by the page on session change. New
   * conversations (no localStorage entry) end up with selectedModelId: null,
   * which the UI surfaces as the admin default.
   */
  hydrateSelectedModelForSession: (sessionId: string) => void;
  setWorkspaceIds: (ids: string[]) => void;
  clearTypewriter: () => void;
  /** Optimistic rename of the current session. Updates title and pointer list. */
  renameCurrent: (title: string) => Promise<void>;
  /** Delete the current session. Resolves once removed from pointer list. */
  deleteCurrent: () => Promise<void>;
}

const initial: State = {
  sessionId: null,
  title: null,
  events: [],
  streaming: false,
  streamError: null,
  rightPanelMode: 'closed',
  filesSheetOpen: false,
  selectedToolCallId: null,
  liveToolCallId: null,
  liveAssistantIds: new Set<string>(),
  selectedModelId: null,
  lastSequence: 0,
  systemWorkspaceId: null,
  workspaceIds: [],
  typewriterSessionId: null,
  typewriterName: null,
};

export const useConversationV2Store = create<State & Actions>()(
  devtools(
    (set, get) => ({
      ...initial,
      setSessionId: (id) => set({ sessionId: id }, false, 'setSessionId'),
      setStreaming: (s) => set({ streaming: s }, false, 'setStreaming'),
      reset: () => set(initial, false, 'reset'),
      openToolPanel: (toolCallId) =>
        set({ rightPanelMode: 'tool', selectedToolCallId: toolCallId }, false, 'openToolPanel'),
      jumpToLive: () =>
        set(
          (s) =>
            s.liveToolCallId
              ? { rightPanelMode: 'tool', selectedToolCallId: s.liveToolCallId }
              : {},
          false,
          'jumpToLive',
        ),
      closeRightPanel: () =>
        set({ rightPanelMode: 'closed', selectedToolCallId: null }, false, 'closeRightPanel'),
      setSystemWorkspaceId: (id) =>
        set({ systemWorkspaceId: id }, false, 'setSystemWorkspaceId'),
      setWorkspaceIds: (ids) => set({ workspaceIds: ids }, false, 'setWorkspaceIds'),
      clearTypewriter: () =>
        set(
          { typewriterSessionId: null, typewriterName: null },
          false,
          'clearTypewriter',
        ),
      renameCurrent: async (title) => {
        const id = get().sessionId;
        if (!id) return;
        const previous = get().title;
        set({ title }, false, 'renameCurrent/optimistic');
        try {
          await useConversationV2PointersStore.getState().rename(id, title);
        } catch (err) {
          set({ title: previous }, false, 'renameCurrent/rollback');
          throw err;
        }
      },
      deleteCurrent: async () => {
        const id = get().sessionId;
        if (!id) return;
        await useConversationV2PointersStore.getState().remove(id);
      },
      setFilesSheetOpen: (open) =>
        set({ filesSheetOpen: open }, false, `setFilesSheetOpen/${open}`),
      replayEvents: (events) =>
        set(
          {
            events: dedupeReplayEvents(events),
            title: deriveTitle(events) ?? null,
            liveToolCallId: null,
            liveAssistantIds: new Set<string>(),
            lastSequence: events.reduce(
              (max, e) =>
                typeof (e as { sequence?: number }).sequence === 'number'
                  ? Math.max(max, (e as { sequence: number }).sequence)
                  : max,
              0,
            ),
          },
          false,
          'replayEvents',
        ),
      stop: async () => {
        const id = get().sessionId;
        if (!id) return;
        await conversationV2Api.stopSession(id);
      },
      pause: async () => {
        const id = get().sessionId;
        if (!id) return;
        await conversationV2Api.pauseSession(id);
      },
      resume: async () => {
        const id = get().sessionId;
        if (!id) return;
        await conversationV2Api.resumeSession(id);
      },
      setSelectedModelId: (modelId) => {
        set({ selectedModelId: modelId }, false, 'setSelectedModelId');
        const id = get().sessionId;
        if (id) writeSelectedModelForSession(id, modelId);
      },
      hydrateSelectedModelForSession: (sessionId) => {
        const stored = readSelectedModelForSession(sessionId);
        set({ selectedModelId: stored }, false, 'hydrateSelectedModelForSession');
      },
      handleEvent: (event) =>
        set(
          (state) => {
            const incomingSeq = (event as { sequence?: number }).sequence;
            if (typeof incomingSeq === 'number' && incomingSeq <= state.lastSequence) {
              return {};
            }
            const nextLastSequence =
              typeof incomingSeq === 'number'
                ? Math.max(state.lastSequence, incomingSeq)
                : state.lastSequence;
            const withSeq = <T>(patch: T) => ({ ...patch, lastSequence: nextLastSequence });

            switch (event.type) {
              case 'title': {
                // Trigger header typewriter when the title actually changed.
                // Live tail uses `since` so we won't re-animate on reload;
                // optimistic rename writes directly via renameCurrent and
                // never routes through SSE, so this only fires on
                // freshly-generated titles.
                const isFresh =
                  state.sessionId !== null &&
                  event.title.length > 0 &&
                  event.title !== state.title;
                // Mirror the title into the pointer list so the sidebar
                // updates in lockstep with the header.
                if (isFresh && state.sessionId) {
                  const sid = state.sessionId;
                  const newTitle = event.title;
                  useConversationV2PointersStore.setState(
                    (p) => ({
                      items: p.items.map((row) =>
                        row.sessionId === sid ? { ...row, title: newTitle } : row,
                      ),
                    }),
                    false,
                    'pointers/title-sync',
                  );
                }
                return withSeq({
                  title: event.title,
                  ...(isFresh
                    ? {
                        typewriterSessionId: state.sessionId,
                        typewriterName: event.title,
                      }
                    : {}),
                });
              }
              case 'done':
                return withSeq({ streaming: false, liveToolCallId: null });
              case 'error':
                return withSeq({
                  streamError: event.error,
                  streaming: false,
                  liveToolCallId: null,
                });
              case 'tool': {
                const turnStart = currentTurnStartIndex(state.events);
                const idx = findIndexFrom(
                  state.events,
                  turnStart,
                  (e) => e.type === 'tool' && e.tool_call_id === event.tool_call_id,
                );
                const isMessageTool = (event.name || '').toLowerCase() === 'message';
                // Track the latest non-message tool as the "live" target.
                const nextLive = !isMessageTool ? event.tool_call_id : state.liveToolCallId;
                // Auto-follow live: if the user is currently watching the live tool (or has
                // no selection yet), advance the selection to the new live tool.
                const followingLive =
                  !isMessageTool &&
                  (state.selectedToolCallId === null ||
                    state.selectedToolCallId === state.liveToolCallId);
                const autoOpen =
                  !isMessageTool && followingLive
                    ? {
                        rightPanelMode: 'tool' as const,
                        selectedToolCallId: event.tool_call_id,
                      }
                    : {};
                if (idx >= 0) {
                  const next = state.events.slice();
                  next[idx] = event;
                  return withSeq({ events: next, liveToolCallId: nextLive, ...autoOpen });
                }
                return withSeq({
                  events: [...state.events, event],
                  liveToolCallId: nextLive,
                  ...autoOpen,
                });
              }
              case 'step': {
                const turnStart = currentTurnStartIndex(state.events);
                const idx = findIndexFrom(
                  state.events,
                  turnStart,
                  (e) => e.type === 'step' && e.id === event.id,
                );
                if (idx >= 0) {
                  const next = state.events.slice();
                  next[idx] = event;
                  return withSeq({ events: next });
                }
                return withSeq({ events: [...state.events, event] });
              }
              case 'plan': {
                // Replace any existing plan with the latest
                const filtered = state.events.filter((e) => e.type !== 'plan');
                return withSeq({ events: [...filtered, event] });
              }
              case 'wait':
                return withSeq({});
              case 'message': {
                const nextLiveAssistantIds =
                  event.role === 'assistant'
                    ? new Set(state.liveAssistantIds).add(event.event_id)
                    : state.liveAssistantIds;
                // Upsert by event_id so the SSE-emitted user message replaces
                // the frontend's optimistic echo (same event_id), and any
                // accidental duplicate assistant frame (e.g., direct SSE +
                // gap-fill listEvents) doesn't render twice.
                const existingIdx = state.events.findIndex(
                  (e) => e.type === 'message' && e.event_id === event.event_id,
                );
                if (existingIdx >= 0) {
                  const next = state.events.slice();
                  next[existingIdx] = event;
                  return withSeq({ events: next, liveAssistantIds: nextLiveAssistantIds });
                }
                return withSeq({
                  events: [...state.events, event],
                  liveAssistantIds: nextLiveAssistantIds,
                });
              }
              default:
                return withSeq({ events: [...state.events, event] });
            }
          },
          false,
          `handleEvent/${event.type}`,
        ),
    }),
    { name: 'conversation-v2' },
  ),
);

function deriveTitle(events: AgentEvent[]): string | undefined {
  const last = [...events].reverse().find((e) => e.type === 'title');
  return last?.type === 'title' ? last.title : undefined;
}

/**
 * Returns the index immediately after the last "turn boundary" — a `user`
 * message. Tool/step upserts only consider events at or after this index so
 * the next turn never collides with the previous one when ids are reused.
 */
function currentTurnStartIndex(events: AgentEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'message' && ev.role === 'user') return i;
  }
  return 0;
}

function findIndexFrom<T>(arr: T[], start: number, pred: (t: T) => boolean): number {
  for (let i = start; i < arr.length; i++) if (pred(arr[i])) return i;
  return -1;
}

/**
 * Server-side history can contain multiple records per logical entity (a tool
 * call yields `calling` + `called`, a step yields `running` + `completed`, the
 * plan is re-emitted every step). The live SSE path upserts those in place;
 * replayEvents must apply the same collapse so the rendered list has one row
 * per tool_call_id / step.id and only the latest plan, otherwise React renders
 * duplicate keys and the conversation appears to repeat itself.
 */
function dedupeReplayEvents(events: AgentEvent[]): AgentEvent[] {
  // Indices are scoped to the current "turn". A turn ends at every user
  // message and at every done/error marker so that the next turn can reuse
  // step ids (which Manus does — every task starts numbering at "1") without
  // colliding with the previous turn's bookkeeping.
  let toolIndex = new Map<string, number>();
  let stepIndex = new Map<string, number>();
  let latestPlanIdx: number | null = null;
  const result: AgentEvent[] = [];

  const resetTurn = () => {
    toolIndex = new Map();
    stepIndex = new Map();
    latestPlanIdx = null;
  };

  for (const ev of events) {
    if (ev.type === 'title' || ev.type === 'wait') continue;

    if (ev.type === 'done' || ev.type === 'error') {
      result.push(ev);
      resetTurn();
      continue;
    }

    if (ev.type === 'message') {
      if (ev.role === 'user') resetTurn();
      result.push(ev);
      continue;
    }

    if (ev.type === 'tool') {
      const existing = toolIndex.get(ev.tool_call_id);
      if (existing !== undefined) {
        result[existing] = ev;
      } else {
        toolIndex.set(ev.tool_call_id, result.length);
        result.push(ev);
      }
      continue;
    }

    if (ev.type === 'step') {
      const existing = stepIndex.get(ev.id);
      if (existing !== undefined) {
        result[existing] = ev;
      } else {
        stepIndex.set(ev.id, result.length);
        result.push(ev);
      }
      continue;
    }

    if (ev.type === 'plan') {
      if (latestPlanIdx !== null) {
        result[latestPlanIdx] = ev;
      } else {
        latestPlanIdx = result.length;
        result.push(ev);
      }
      continue;
    }

    result.push(ev);
  }

  return result;
}

export const DEFAULT_V2_LIMIT = 20;

interface PointersState {
  items: ConversationV2PointerSummary[];
  loading: boolean;
  nextCursor: string | null;
  error: string | null;
}

interface PointersActions {
  fetch: (opts?: { reset?: boolean; limit?: number; q?: string }) => Promise<void>;
  /**
   * Insert a freshly-created session at the top of the list. Used by the new
   * conversation flow so the sidebar updates immediately rather than waiting
   * for a refresh.
   */
  prepend: (pointer: ConversationV2PointerSummary) => void;
  rename: (sessionId: string, title: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  setShared: (sessionId: string, isShared: boolean) => Promise<string | null>;
  reset: () => void;
}

const initialPointers: PointersState = { items: [], loading: false, nextCursor: null, error: null };

export const useConversationV2PointersStore = create<PointersState & PointersActions>()(
  devtools(
    (set, get) => ({
      ...initialPointers,
      reset: () => set(initialPointers, false, 'pointers/reset'),
      fetch: async ({ reset = false, limit = DEFAULT_V2_LIMIT, q } = {}) => {
        set({ loading: true, error: null }, false, 'pointers/fetch:start');
        try {
          const cursor = reset ? null : get().nextCursor;
          const { items, nextCursor } = await conversationV2Api.listSessions({ limit, cursor, q });
          set(
            (s) => {
              const combined = reset ? items : [...s.items, ...items];
              const seen = new Set<string>();
              const deduped = combined.filter((p) => {
                if (seen.has(p.sessionId)) return false;
                seen.add(p.sessionId);
                return true;
              });
              return { items: deduped, nextCursor, loading: false };
            },
            false,
            'pointers/fetch:done',
          );
        } catch (err) {
          set({ loading: false, error: (err as Error).message }, false, 'pointers/fetch:err');
        }
      },
      prepend: (pointer) =>
        set(
          (s) => {
            if (s.items.some((p) => p.sessionId === pointer.sessionId)) return {};
            return { items: [pointer, ...s.items] };
          },
          false,
          'pointers/prepend',
        ),
      rename: async (sessionId, title) => {
        const { title: newTitle } = await conversationV2Api.patchSession(sessionId, { title });
        set(
          (s) => ({ items: s.items.map((p) => (p.sessionId === sessionId ? { ...p, title: newTitle ?? p.title } : p)) }),
          false,
          'pointers/rename',
        );
      },
      remove: async (sessionId) => {
        await conversationV2Api.deleteSession(sessionId);
        set(
          (s) => ({ items: s.items.filter((p) => p.sessionId !== sessionId) }),
          false,
          'pointers/remove',
        );
      },
      setShared: async (sessionId, isShared) => {
        const { shareToken } = await conversationV2Api.patchSession(sessionId, { isShared });
        set(
          (s) => ({ items: s.items.map((p) => (p.sessionId === sessionId ? { ...p, isShared } : p)) }),
          false,
          'pointers/setShared',
        );
        return shareToken ?? null;
      },
    }),
    { name: 'conversation-v2-pointers' },
  ),
);
