import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AgentEvent, ConversationV2PointerSummary, FilesTreeNode } from './types';
import { conversationV2Api } from './api';
import type { DeployStatus } from './api';
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
  rightPanelMode: 'closed' | 'tool' | 'app';
  /** Latest agent-pushed application component for the current session.
   *  Nodepod boots from cephPath + filesTree; `url` is retained for deploy links. */
  applicationComponent: {
    url: string;
    title: string;
    cephPath?: string;
    filesTree?: FilesTreeNode | null;
    fileCount?: number;
    revision: string;
  } | null;
  /** Files-in-this-conversation sheet open state. Independent of the right
   *  panel so the user can keep the tool detail open while browsing files. */
  filesSheetOpen: boolean;
  systemWorkspaceId: string | null;
  /** workspaceIds attached to this session (read-only here; set on session load). */
  workspaceIds: string[];
  /** App-deployment ("Publish") state for the current session. Hydrated from
   *  getSession on load; `deploying` is set locally while the deploy POST is
   *  in flight (drives the header button's loader). */
  deployStatus: DeployStatus;
  deployedUrl: string | null;
  lastDeployedAt: string | null;
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
  /** Selected connector repository for the current session. */
  selectedConnectorRepo: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  } | null;
  /** Skill IDs selected for the conversation; sent with every message. */
  selectedSkillIds: string[];
  /** Connector IDs selected for the conversation; sent with every message. */
  selectedConnectorIds: string[];
  /**
   * Live state for conversations that are streaming in the BACKGROUND (i.e. not
   * the one currently on screen). Events arriving on the per-user pipe for a
   * non-current session accumulate here, keyed by sessionId, so switching to
   * that conversation is instant and shows everything that streamed while it
   * was off-screen. Mirrors v1's `streamingStateCache`.
   */
  streamingStateCache: Map<string, SessionSlice>;
}

/**
 * The portion of a conversation's live state that must survive being switched
 * away from. The top-level store fields above hold this for the CURRENT
 * session; `streamingStateCache` holds one of these per background session.
 */
export interface SessionSlice {
  events: AgentEvent[];
  lastSequence: number;
  liveToolCallId: string | null;
  liveAssistantIds: Set<string>;
  title: string | null;
  streaming: boolean;
  streamError: string | null;
}

interface Actions {
  setSessionId: (id: string | null) => void;
  setStreaming: (s: boolean) => void;
  handleEvent: (event: AgentEvent) => void;
  /**
   * Entry point for an event off the per-user pipe. Routes by `sessionId`:
   * events for the current session render live; events for other sessions
   * accumulate in `streamingStateCache`.
   */
  handleStreamEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => void;
  /** Fetch persisted events after reconnect so a missed final event cannot leave the UI streaming. */
  reconcileCurrentSession: () => Promise<void>;
  /**
   * Switch the on-screen conversation, preserving background streams. Stashes
   * the outgoing session's live state if it is still streaming, and hydrates
   * the incoming one from cache when available. Returns true when hydrated from
   * cache (caller can skip the server reload + spinner).
   */
  switchToSession: (id: string) => boolean;
  /** Send a message in the current session (optimistic echo + POST). */
  sendMessage: (message: string, model?: string) => Promise<void>;
  replayEvents: (events: AgentEvent[]) => void;
  reset: () => void;
  openToolPanel: (toolCallId: string) => void;
  /** Switch the right panel between the Code (tool) and Preview (app) tabs.
   *  Only meaningful when both a tool and an application component exist. */
  setRightPanelView: (view: 'code' | 'preview') => void;
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
  /** Apply deploy state hydrated from getSession (on session load/switch). */
  setDeployState: (state: {
    deployStatus: DeployStatus;
    deployedUrl: string | null;
    lastDeployedAt?: string | null;
  }) => void;
  /** Publish/deploy the current session's app. Flips to 'deploying' immediately,
   *  then 'deployed' (+ url) or 'error' once the backend responds. */
  deploy: () => Promise<void>;
  clearTypewriter: () => void;
  /** Set the selected connector repository for the session. */
  setSelectedConnectorRepo: (repo: State['selectedConnectorRepo']) => void;
  /** Replace the full set of selected skills for the conversation. */
  setSelectedSkillIds: (ids: string[]) => void;
  /** Toggle one skill on/off for the conversation. */
  toggleSelectedSkill: (id: string) => void;
  /** Replace the full set of selected connectors for the conversation. */
  setSelectedConnectorIds: (ids: string[]) => void;
  /** Toggle one connector on/off for the conversation. */
  toggleSelectedConnector: (id: string) => void;
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
  applicationComponent: null,
  filesSheetOpen: false,
  selectedToolCallId: null,
  liveToolCallId: null,
  liveAssistantIds: new Set<string>(),
  selectedModelId: null,
  lastSequence: 0,
  systemWorkspaceId: null,
  workspaceIds: [],
  deployStatus: 'idle',
  deployedUrl: null,
  lastDeployedAt: null,
      typewriterSessionId: null,
      typewriterName: null,
      selectedConnectorRepo: null,
      selectedSkillIds: [],
      selectedConnectorIds: [],
      streamingStateCache: new Map<string, SessionSlice>(),
};

const sessionReconciliations = new Map<string, Promise<void>>();

/** Empty slice for a not-yet-seen background session. */
function emptySlice(): SessionSlice {
  return {
    events: [],
    lastSequence: 0,
    liveToolCallId: null,
    liveAssistantIds: new Set<string>(),
    title: null,
    streaming: true,
    streamError: null,
  };
}

/**
 * Pure reducer applying a single agent event to a session slice. Mirrors the
 * data transforms in `handleEvent` (upsert tool/step/message by id, replace
 * plan, track liveToolCallId/liveAssistantIds, terminal flags) WITHOUT the
 * current-session UI side effects (panel auto-open, typewriter). Used for
 * background sessions in `streamingStateCache`.
 */
function reduceSession(slice: SessionSlice, event: AgentEvent): SessionSlice {
  const incomingSeq = (event as { sequence?: number }).sequence;
  if (typeof incomingSeq === 'number' && incomingSeq <= slice.lastSequence) {
    return slice; // stale or duplicate
  }
  const lastSequence =
    typeof incomingSeq === 'number'
      ? Math.max(slice.lastSequence, incomingSeq)
      : slice.lastSequence;
  const base: SessionSlice = { ...slice, lastSequence };

  switch (event.type) {
    case 'title':
      return { ...base, title: event.title };
    case 'done':
      return { ...base, streaming: false, liveToolCallId: null };
    case 'error':
      return { ...base, streamError: event.error, streaming: false, liveToolCallId: null };
    case 'tool': {
      const turnStart = currentTurnStartIndex(slice.events);
      const idx = findIndexFrom(
        slice.events,
        turnStart,
        (e) => e.type === 'tool' && e.tool_call_id === event.tool_call_id,
      );
      const isMessageTool = (event.name || '').toLowerCase() === 'message';
      const liveToolCallId = !isMessageTool ? event.tool_call_id : slice.liveToolCallId;
      let events: AgentEvent[];
      if (idx >= 0) {
        events = slice.events.slice();
        events[idx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events, liveToolCallId };
    }
    case 'step': {
      const turnStart = currentTurnStartIndex(slice.events);
      const idx = findIndexFrom(
        slice.events,
        turnStart,
        (e) => e.type === 'step' && e.id === event.id,
      );
      let events: AgentEvent[];
      if (idx >= 0) {
        events = slice.events.slice();
        events[idx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events };
    }
    case 'plan': {
      const filtered = slice.events.filter((e) => e.type !== 'plan');
      return { ...base, events: [...filtered, event] };
    }
    case 'wait':
      // The agent is paused waiting for the user's reply — re-enable the input
      // (same as 'done'), otherwise the composer stays stuck in streaming.
      return { ...base, streaming: false, liveToolCallId: null };
    case 'message': {
      const liveAssistantIds =
        event.role === 'assistant'
          ? new Set(slice.liveAssistantIds).add(event.event_id)
          : slice.liveAssistantIds;
      const existingIdx = slice.events.findIndex(
        (e) => e.type === 'message' && e.event_id === event.event_id,
      );
      let events: AgentEvent[];
      if (existingIdx >= 0) {
        events = slice.events.slice();
        events[existingIdx] = event;
      } else {
        events = [...slice.events, event];
      }
      return { ...base, events, liveAssistantIds };
    }
    default:
      return { ...base, events: [...slice.events, event] };
  }
}

/** Snapshot the current top-level session state into a slice (for caching). */
function sliceFromState(s: State): SessionSlice {
  return {
    events: s.events,
    lastSequence: s.lastSequence,
    liveToolCallId: s.liveToolCallId,
    liveAssistantIds: s.liveAssistantIds,
    title: s.title,
    streaming: s.streaming,
    streamError: s.streamError,
  };
}

/** The view fields reset when entering a session with no cached slice. */
function freshViewState(): Partial<State> {
  return {
    events: [],
    title: null,
    streaming: false,
    streamError: null,
    lastSequence: 0,
    liveToolCallId: null,
    liveAssistantIds: new Set<string>(),
    selectedToolCallId: null,
    rightPanelMode: 'closed',
    applicationComponent: null,
    filesSheetOpen: false,
    systemWorkspaceId: null,
    workspaceIds: [],
    deployStatus: 'idle',
    deployedUrl: null,
    lastDeployedAt: null,
    typewriterSessionId: null,
    typewriterName: null,
    selectedConnectorRepo: null,
  };
}

export const useConversationV2Store = create<State & Actions>()(
  devtools(
    (set, get) => ({
      ...initial,
      setSessionId: (id) => set({ sessionId: id }, false, 'setSessionId'),
      setStreaming: (s) => set({ streaming: s }, false, 'setStreaming'),
      // Reset the on-screen view but PRESERVE the background-stream cache —
      // starting a new chat must not wipe other conversations still streaming.
      reset: () =>
        set((s) => ({ ...initial, streamingStateCache: s.streamingStateCache }), false, 'reset'),

      switchToSession: (id) => {
        const s = get();
        let cache = s.streamingStateCache;
        // Stash the outgoing session's live state if it is still streaming, so
        // returning to it is instant and nothing streamed off-screen is lost.
        if (s.sessionId && s.sessionId !== id && s.streaming) {
          cache = new Map(cache);
          cache.set(s.sessionId, sliceFromState(s));
        }
        const cached = cache.get(id);
        if (cached) {
          const newCache = new Map(cache);
          newCache.delete(id);
          const applicationComponent = deriveApplicationComponent(cached.events);
          set(
            {
              ...freshViewState(),
              sessionId: id,
              events: cached.events,
              lastSequence: cached.lastSequence,
              liveToolCallId: cached.liveToolCallId,
              liveAssistantIds: cached.liveAssistantIds,
              title: cached.title,
              streaming: cached.streaming,
              streamError: cached.streamError,
              applicationComponent,
              ...(applicationComponent ? { rightPanelMode: 'app' as const } : {}),
              streamingStateCache: newCache,
            },
            false,
            'switchToSession/hydrate',
          );
          if (cached.streaming) void get().reconcileCurrentSession();
          return true;
        }
        set(
          { ...freshViewState(), sessionId: id, streamingStateCache: cache },
          false,
          'switchToSession/fresh',
        );
        return false;
      },

      sendMessage: async (message, model) => {
        const sessionId = get().sessionId;
        if (!sessionId) return;
        // Optimistically echo the user message under a client id; the backend
        // persists the same id and re-emits it over the pipe, where the
        // `message` upsert replaces this echo instead of duplicating it.
        const clientEventId = crypto.randomUUID();
        get().handleEvent({
          type: 'message',
          event_id: clientEventId,
          timestamp: Math.floor(Date.now() / 1000),
          role: 'user',
          content: message,
          attachments: [],
        } as AgentEvent);
        set({ streaming: true, streamError: null }, false, 'sendMessage/optimistic');

        const repo = get().selectedConnectorRepo;
        const skillIds = get().selectedSkillIds;
        const connectorIds = get().selectedConnectorIds;
        try {
          await conversationV2Api.sendMessage(sessionId, {
            message,
            model,
            clientEventId,
            ...(repo
              ? {
                  connectorId: repo.connectorId,
                  connectorName: repo.connectorName,
                  connectorRepoId: repo.repoId,
                  connectorRepoName: repo.repoName,
                  connectorRepoUrl: repo.repoUrl,
                }
              : {}),
            ...(skillIds.length ? { skillIds } : {}),
            ...(connectorIds.length ? { connectorIds } : {}),
          });
        } catch (err) {
          set(
            { streaming: false, streamError: (err as Error).message },
            false,
            'sendMessage/error',
          );
        }
      },

      handleStreamEvent: (type, data) => {
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
        const { sessionId: _omit, ...rest } = data;
        const event = { type, ...rest } as AgentEvent;
        const state = get();

        // Background session — accumulate in the cache; mirror title to sidebar.
        if (sessionId && sessionId !== state.sessionId) {
          set(
            (s) => {
              const cache = new Map(s.streamingStateCache);
              const prev = cache.get(sessionId) ?? emptySlice();
              cache.set(sessionId, reduceSession(prev, event));
              return { streamingStateCache: cache };
            },
            false,
            `handleStreamEvent/bg/${type}`,
          );
          if (event.type === 'title' && event.title) {
            const title = event.title;
            useConversationV2PointersStore.setState(
              (p) => ({
                items: p.items.map((row) =>
                  row.sessionId === sessionId ? { ...row, title } : row,
                ),
              }),
              false,
              'pointers/title-sync-bg',
            );
          }
          return;
        }

        // Current session — gap-backfill (a jump in sequence means we missed
        // events, e.g. across a pipe reconnect) then apply live.
        const seq = (event as { sequence?: number }).sequence;
        if (typeof seq === 'number' && seq > state.lastSequence + 1 && state.sessionId) {
          const fillFrom = state.lastSequence;
          const sid = state.sessionId;
          (async () => {
            let cursor = fillFrom;
            while (cursor < seq - 1) {
              try {
                const { items, nextSince } = await conversationV2Api.listEvents(sid, cursor, 200);
                if (items.length === 0) break;
                for (const e of items) get().handleEvent(e);
                if (nextSince === cursor) break;
                cursor = nextSince;
              } catch {
                return; // a later event will trigger another attempt
              }
            }
            get().handleEvent(event);
          })();
        } else {
          get().handleEvent(event);
        }
      },
      reconcileCurrentSession: async () => {
        const state = get();
        const sessionId = state.sessionId;
        if (!sessionId || !state.streaming) return;

        const existing = sessionReconciliations.get(sessionId);
        if (existing) return existing;

        const reconciliation = (async () => {
          let cursor = get().sessionId === sessionId ? get().lastSequence : 0;
          while (get().sessionId === sessionId && get().streaming) {
            const { items, nextSince } = await conversationV2Api.listEvents(sessionId, cursor, 200);
            for (const event of items) {
              if (get().sessionId !== sessionId) return;
              get().handleEvent(event);
            }
            if (items.length < 200 || nextSince <= cursor) return;
            cursor = nextSince;
          }
        })().catch((err) => {
          console.error('[ConversationV2Store] session reconciliation failed:', err);
        }).finally(() => {
          sessionReconciliations.delete(sessionId);
        });

        sessionReconciliations.set(sessionId, reconciliation);
        return reconciliation;
      },
      openToolPanel: (toolCallId) =>
        set({ rightPanelMode: 'tool', selectedToolCallId: toolCallId }, false, 'openToolPanel'),
      setRightPanelView: (view) =>
        set(
          { rightPanelMode: view === 'preview' ? 'app' : 'tool' },
          false,
          `setRightPanelView/${view}`,
        ),
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
      setDeployState: ({ deployStatus, deployedUrl, lastDeployedAt }) =>
        set(
          {
            deployStatus,
            deployedUrl,
            ...(lastDeployedAt !== undefined ? { lastDeployedAt } : {}),
          },
          false,
          'setDeployState',
        ),
      deploy: async () => {
        const id = get().sessionId;
        if (!id) return;
        set({ deployStatus: 'deploying' }, false, 'deploy/start');
        try {
          const r = await conversationV2Api.deploySession(
            id,
            get().applicationComponent?.title,
          );
          get().setDeployState({
            deployStatus: r.deployStatus,
            deployedUrl: r.deployedUrl,
            lastDeployedAt: r.lastDeployedAt,
          });
        } catch (err) {
          set({ deployStatus: 'error' }, false, 'deploy/error');
          throw err;
        }
      },
      clearTypewriter: () =>
        set(
          { typewriterSessionId: null, typewriterName: null },
          false,
          'clearTypewriter',
        ),
      setSelectedConnectorRepo: (repo) =>
        set({ selectedConnectorRepo: repo }, false, 'setSelectedConnectorRepo'),
      setSelectedSkillIds: (ids) =>
        set({ selectedSkillIds: ids }, false, 'setSelectedSkillIds'),
      toggleSelectedSkill: (id) =>
        set(
          (s) => ({
            selectedSkillIds: s.selectedSkillIds.includes(id)
              ? s.selectedSkillIds.filter((x) => x !== id)
              : [...s.selectedSkillIds, id],
          }),
          false,
          'toggleSelectedSkill',
        ),
      setSelectedConnectorIds: (ids) =>
        set({ selectedConnectorIds: ids }, false, 'setSelectedConnectorIds'),
      toggleSelectedConnector: (id) =>
        set(
          (s) => ({
            selectedConnectorIds: s.selectedConnectorIds.includes(id)
              ? s.selectedConnectorIds.filter((x) => x !== id)
              : [...s.selectedConnectorIds, id],
          }),
          false,
          'toggleSelectedConnector',
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
      replayEvents: (events) => {
        const applicationComponent = deriveApplicationComponent(events);
        set(
          {
            events: dedupeReplayEvents(events),
            title: deriveTitle(events) ?? null,
            liveToolCallId: null,
            liveAssistantIds: new Set<string>(),
            applicationComponent,
            // Re-surface the app viewer on reload when the session has one.
            ...(applicationComponent ? { rightPanelMode: 'app' as const } : {}),
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
        );
      },
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
                // Follow the live tool in the Code view: always advance the
                // selection so the Code tab tracks the newest tool. But DON'T
                // pull the panel back onto the code view when the user is
                // watching the app preview ('app' mode) — the preview stays put,
                // the Code tab just updates in the background. Opening from
                // 'closed' or staying in 'tool' still shows the code.
                const autoOpen =
                  !isMessageTool && followingLive
                    ? {
                        selectedToolCallId: event.tool_call_id,
                        ...(state.rightPanelMode !== 'app'
                          ? { rightPanelMode: 'tool' as const }
                          : {}),
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
                // Agent paused for the user's reply — re-enable the composer.
                return withSeq({ streaming: false, liveToolCallId: null });
              case 'application_component':
                // Agent pushed an embeddable app: boot Nodepod from Ceph sources.
                console.log('[Nodepod] [sse:application_component]', {
                  event_id: event.event_id,
                  url: event.url,
                  title: event.title,
                  ceph_path: event.ceph_path,
                  file_count: event.file_count,
                  hasFilesTree: !!event.files_tree,
                });
                return withSeq({
                  events: [...state.events, event],
                  applicationComponent: {
                    url: event.url,
                    title: event.title ?? '',
                    cephPath: event.ceph_path,
                    filesTree: event.files_tree ?? null,
                    fileCount: event.file_count,
                    revision: event.event_id,
                  },
                  rightPanelMode: 'app',
                });
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
 * The application component to show in the side panel is whatever the agent
 * pushed last. Used on replay/session-switch to restore the app viewer from
 * persisted history (the live path sets it directly in handleEvent).
 */
function deriveApplicationComponent(
  events: AgentEvent[],
): {
  url: string;
  title: string;
  cephPath?: string;
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  revision: string;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'application_component') {
      console.log('[Nodepod] [replay:deriveApplicationComponent]', {
        event_id: ev.event_id,
        url: ev.url,
        title: ev.title,
        ceph_path: ev.ceph_path,
        file_count: ev.file_count,
        hasFilesTree: !!ev.files_tree,
      });
      return {
        url: ev.url,
        title: ev.title ?? '',
        cephPath: ev.ceph_path,
        filesTree: ev.files_tree ?? null,
        fileCount: ev.file_count,
        revision: ev.event_id,
      };
    }
  }
  return null;
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
