import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { useModelsStore, DEFAULT_MODEL_CHANGED_EVENT } from '@/modules/models/store';
import * as api from './api';
import { getStreamErrorMessage } from './utils';
import { insertMessageChronologically } from './utils/message-order';
import { conversationStreamService } from './stream';
import { translateConversation } from './translation';
import { computeFrontendLatency, mergeLatencyMetrics, type FrontendPaintComputation } from './utils/latency-paint';
import { streamMetrics } from './utils/stream-metrics';
import { createLatencyPaintController, type PendingLatencyPaint } from './store-latency';
import type { Conversation, ConversationSummary, ConversationUsageMetrics, Message, MessageComponent, StreamingComponent, SendMessagePayload, CreateReportPayload, StreamStartEvent, StreamChunkEvent, StreamCompleteEvent, StreamErrorEvent, ConversationNameGeneratedEvent, SSEConnectionStatus, MessageCreatedEvent, MessageUpdatedEvent, StreamResyncRequiredEvent, StreamChunkLatencyData, ActiveStreamSnapshot } from './types';

export type { PendingLatencyPaint };

/** Shared first-paint lifecycle for the latency instrumentation. */
const latencyPaint = createLatencyPaintController();

export const DEFAULT_CONVERSATIONS_LIMIT = 12;
const DEFAULT_MESSAGES_LIMIT = 5;
let currentConversationRequestSequence = 0;
let currentMessagesRequestSequence = 0;
let conversationListRequestSequence = 0;
let currentStreamRevision = 0;
let currentRevisionStreamKey: string | null = null;
let receivedCurrentStreamStart = false;
let pendingRecoveryChunks: BufferedStreamChunk[] = [];
/**
 * Forced-resync hold: while a `stream_resync_required` repair fetches the
 * authoritative snapshot, arriving deltas of the affected conversation are
 * held here instead of being applied to the (known-stale) live state, then
 * applied only when newer than the installed snapshot.
 */
let resyncHoldActive = false;
let resyncHoldConversationId: string | null = null;
let resyncHeldChunks: BufferedStreamChunk[] = [];
let forcedResyncInFlight = false;
let missingStartRecoveryInFlight = false;
/**
 * Backlog caps: the snapshot repair supersedes anything beyond these bounds,
 * so the recovery queues can never grow with a long-running stream.
 */
const MAX_PENDING_RECOVERY_CHUNKS = 500;
const MAX_RESYNC_HELD_CHUNKS = 500;
let pendingStreamReconcileTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStreamReconcileAttempts = 0;
let pendingStreamReconcileInFlight = false;
let pendingStreamReconcileTarget: string | null = null;
const PENDING_STREAM_RECONCILE_INTERVAL_MS = 2_000;
const MAX_PENDING_STREAM_RECONCILE_ATTEMPTS = 150;

type BufferedStreamChunk = {
  action: 'add' | 'update' | 'delete';
  component: StreamingComponent;
  revision?: number;
};

/**
 * Attach the browser-computed sixth latency metric to a persisted message.
 * Never overwrites an already-present frontend value. Delegates to the shared
 * controller; kept as a wrapper for the message merge call sites.
 */
function withPendingLatency(message: Message): Message {
  return latencyPaint.mergeIntoMessage(message);
}

// ===== Streaming Helper Functions =====

/** Cached streaming state for conversations that are streaming in the background. */
interface CachedStreamingState {
  streamingMessageId: string;
  streamingQuestionMessageId: string | null;
  streamingComponents: StreamingComponent[];
  isAwaitingFirstChunk: boolean;
}

/**
 * Runtime-only first-paint tracking for the latency instrumentation.
 * Set when the one-time latency envelope chunk arrives; never persisted.
 * The lifecycle lives in ./store-latency and is shared with the store actions.
 */

/**
 * Apply an array of chunk actions to a components array, returning a new array.
 * Used both by the buffer flush callback (current conversation) and by direct
 * cache updates (background conversations).
 */
export function applyChunksToComponents(components: StreamingComponent[], chunks: BufferedStreamChunk[]): StreamingComponent[] {
  let result = [...components];
  for (const { action, component } of chunks) {
    if (action === 'add') {
      const existingIndex = result.findIndex((item) => item.id === component.id);
      if (component.type === 'toolActivity' && existingIndex >= 0) {
        const existing = result[existingIndex];
        result[existingIndex] = {
          ...existing,
          data: mergeStreamingData('toolActivity', existing.data, component.data),
        };
      } else {
        result.push({
          ...component,
          data: initializeStreamingData(component.type, component.data),
        });
      }
    } else if (action === 'update') {
      const hasExisting = result.some((comp) => comp.id === component.id);
      result = result.map((comp) => {
        if (comp.id !== component.id) return comp;
        return {
          ...comp,
          data: mergeStreamingData(comp.type, comp.data, component.data),
        };
      });
      if (!hasExisting && component.type === 'toolActivity') {
        result.push({
          ...component,
          data: initializeStreamingData(component.type, component.data),
        });
      }
    } else if (action === 'delete') {
      result = result.filter((comp) => comp.id !== component.id);
    }
  }
  return result;
}

/**
 * Streaming chunk queue with frame-oriented coalescing.
 * Chunks arrive fast from SSE; they are applied in ONE store transaction per
 * animation frame (per-frame batching coalesces consecutive deltas to the
 * same component). Hidden tabs have no RAF, so a coarse timer takes over and
 * the queue stays bounded: on overflow the backlog is dropped and canonical
 * state is refetched instead of freezing the tab with a synchronous flush.
 */
const MAX_QUEUED_CHUNKS = 500;
const HIDDEN_TAB_FLUSH_INTERVAL_MS = 250;

class StreamingBuffer {
  private queue: BufferedStreamChunk[] = [];
  private scheduled = false;
  private rafId: number | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: ((chunks: BufferedStreamChunk[]) => void) | null = null;
  private overflowCallback: (() => void) | null = null;

  setFlushCallback(callback: (chunks: BufferedStreamChunk[]) => void) {
    this.flushCallback = callback;
  }

  /** Invoked when the bounded queue overflows; the store reconciles from canonical state. */
  setOverflowCallback(callback: () => void) {
    this.overflowCallback = callback;
  }

  addChunk(action: 'add' | 'update' | 'delete', component: StreamingComponent, revision?: number) {
    streamMetrics.recordQueueEnqueue();
    this.queue.push({ action, component, revision });

    // Hidden-tab safety cap: rather than an unbounded synchronous flush (the
    // old >500 behavior), drop the backlog instead of freezing the tab. The
    // stream continues merging onto the retained tail; there is no mid-stream
    // replay of the dropped span — completion reconciliation restores the
    // canonical persisted message.
    if (this.queue.length > MAX_QUEUED_CHUNKS) {
      this.queue = [];
      this.cancelScheduledFlush();
      const overflow = this.overflowCallback;
      if (overflow) overflow();
      return;
    }

    this.scheduleFlush();
  }

  /** Synchronously drain all remaining chunks (used on stream end / terminal events). */
  flush() {
    this.cancelScheduledFlush();
    if (this.queue.length > 0 && this.flushCallback) {
      const chunks = this.queue.splice(0);
      const startedAt = performance.now();
      this.flushCallback(chunks);
      streamMetrics.recordQueueFlush(chunks.length, performance.now() - startedAt, 1);
    }
  }

  clear() {
    this.queue = [];
    this.cancelScheduledFlush();
  }

  discardThrough(revision: number) {
    this.queue = this.queue.filter((chunk) => chunk.revision === undefined || chunk.revision > revision);
  }

  // --- internals ---

  private scheduleFlush() {
    if (this.scheduled || this.queue.length === 0) return;
    this.scheduled = true;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden) {
      // RAF is suspended while hidden; drain on a coarse timer instead.
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.scheduled = false;
        this.flushQueued();
      }, HIDDEN_TAB_FLUSH_INTERVAL_MS);
    } else if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.scheduled = false;
        this.flushQueued();
      });
    } else {
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.scheduled = false;
        this.flushQueued();
      }, 0);
    }
  }

  private flushQueued() {
    if (this.queue.length === 0 || !this.flushCallback) return;
    const chunks = this.queue.splice(0);
    const startedAt = performance.now();
    this.flushCallback(chunks);
    streamMetrics.recordQueueFlush(chunks.length, performance.now() - startedAt, 1);
  }

  private cancelScheduledFlush() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    this.scheduled = false;
  }
}

const streamingBuffer = new StreamingBuffer();

/** Guards against overlapping snapshot repairs when overflow fires repeatedly. */
let streamSnapshotRepairInFlight = false;
/**
 * Bumped by every authoritative snapshot install (forced resync, missing-start
 * recovery). Older in-flight snapshot fetches compare epochs so a stale fetch
 * resolving late cannot overwrite a fresher installed state.
 */
let snapshotInstallEpoch = 0;

/**
 * Client-metrics window generation: bumped on every send. A deferred
 * completion snapshot from the previous turn is dropped when the generation
 * moved on, so it cannot erase the new turn's freshly recorded counters.
 */
let clientMetricsGeneration = 0;
/**
 * Generation of the turn whose latency envelope was captured mid-stream —
 * stable across the completion boundary, unlike the streaming ids which are
 * nulled as soon as the completion event lands.
 */
let clientMetricsTurnGeneration = 0;
/** Grace window that lets the post-completion code highlight reach the report. */
const CLIENT_METRICS_HIGHLIGHT_GRACE_MS = 250;

/**
 * Repair the dropped span mid-stream: adopt the server's active-stream snapshot
 * (the same canonical component buffer the cold-attach path uses) instead of
 * leaving a gap that only completion reconciliation would heal.
 */
async function repairStreamingComponentsFromSnapshot(conversationId: string): Promise<void> {
  const fetchEpoch = snapshotInstallEpoch;
  let snapshot: ActiveStreamSnapshot | null = null;
  try {
    snapshot = await api.fetchActiveStream(conversationId);
  } catch (err) {
    console.warn('[ConversationStore] active-stream snapshot repair failed; falling back to canonical refetch', err);
  }
  const state = useConversationStore.getState();
  if (!snapshot || state.currentConversationId !== conversationId || !state.isStreaming || state.streamingMessageId !== snapshot.messageId) {
    // Stream finished or moved on while fetching — a canonical refetch covers it.
    void state.fetchMessages(conversationId);
    return;
  }
  if (snapshotInstallEpoch !== fetchEpoch) {
    // A newer authoritative snapshot installed while this fetch was in
    // flight; it already supersedes this (older) repair snapshot.
    return;
  }
  const snapshotRevision = snapshot.revision ?? 0;
  streamingBuffer.discardThrough(snapshotRevision);
  if (currentRevisionStreamKey === `${conversationId}:${snapshot.messageId}`) {
    currentStreamRevision = Math.max(currentStreamRevision, snapshotRevision);
  }
  // Merge instead of replace: the snapshot is the canonical base for every
  // component it contains, while components created by chunks that arrived
  // during the fetch only exist locally and keep their applied state.
  const snapshotIds = new Set(snapshot.components.map((component) => component.id));
  const localOnly = state.streamingComponents.filter((component) => !snapshotIds.has(component.id));
  useConversationStore.setState({
    streamingComponents: [...snapshot.components, ...localOnly],
  });
}

streamingBuffer.setOverflowCallback(() => {
  // Canonical mid-stream resync: the queue dropped older chunks, so reconcile
  // from the server's snapshot (same adoption path as a cold attach).
  const conversationId = useConversationStore.getState().currentConversationId;
  if (!conversationId || streamSnapshotRepairInFlight) return;
  streamSnapshotRepairInFlight = true;
  void repairStreamingComponentsFromSnapshot(conversationId).finally(() => {
    streamSnapshotRepairInFlight = false;
  });
});

/** Standard live flush: batch-apply queued chunks in one store commit per frame. */
function attachStreamingFlushCallback(): void {
  streamingBuffer.setFlushCallback((chunks) => {
    useConversationStore.setState((s) => {
      const components = applyChunksToComponents(s.streamingComponents, chunks);
      const nextState: Partial<ConversationState> = {
        streamingComponents: components,
      };
      if (components.length > 0 && s.isAwaitingFirstChunk) {
        nextState.isAwaitingFirstChunk = false; // hide loader once chunks are renderable
        nextState.awaitingConversationId = null;
      }
      return nextState;
    });
  });
}

/**
 * Install a fetched active-stream snapshot as the canonical live state at its
 * own revision: deltas at or below the snapshot revision are discarded and
 * only newer ones apply on top. `receivedCurrentStreamStart` becomes true so
 * revisioned chunks stop diverting into the recovery backlog. Used by both
 * the missing-start recovery (cold send that missed `stream_start`) and the
 * forced resync (proven replay gap).
 */
function installActiveStreamSnapshot(conversationId: string, snapshot: ActiveStreamSnapshot, heldChunks: BufferedStreamChunk[], options: { replaceComponents: boolean }): void {
  const snapshotRevision = snapshot.revision ?? 0;
  const snapshotKey = `${conversationId}:${snapshot.messageId}`;
  if (currentRevisionStreamKey !== snapshotKey) currentStreamRevision = 0;
  currentRevisionStreamKey = snapshotKey;
  currentStreamRevision = Math.max(currentStreamRevision, snapshotRevision);
  receivedCurrentStreamStart = true;
  streamingBuffer.discardThrough(snapshotRevision);

  const state = useConversationStore.getState();
  const newerChunks = heldChunks.filter((chunk) => chunk.revision === undefined || chunk.revision > snapshotRevision);
  let base = snapshot.components;
  if (!options.replaceComponents) {
    // Components created by chunks that arrived during the fetch exist only
    // locally; the snapshot is the canonical base for everything it contains.
    const snapshotIds = new Set(snapshot.components.map((component) => component.id));
    base = [...snapshot.components, ...state.streamingComponents.filter((component) => !snapshotIds.has(component.id))];
  }
  const components = applyChunksToComponents(base, newerChunks);
  attachStreamingFlushCallback();
  snapshotInstallEpoch += 1;
  useConversationStore.setState({
    isStreaming: true,
    streamingConversationId: conversationId,
    streamingMessageId: snapshot.messageId,
    pendingAssistantMessageId: snapshot.messageId,
    streamingComponents: components,
    ...(components.length > 0 ? { isAwaitingFirstChunk: false, awaitingConversationId: null } : {}),
  });
  streamingBuffer.flush();
}

/**
 * A revisioned chunk arrived without an observed `stream_start` — the
 * immediate-send path can lose the start frame to a not-yet-open SSE pipe on
 * a cold tab. Recover from the server's active-stream snapshot keyed by the
 * conversation (no message id needed): the snapshot installs at its own
 * revision and only newer deltas apply, so progressive rendering no longer
 * depends on the POST ack or the SSE handshake ordering.
 */
async function recoverMissingStreamStart(conversationId: string): Promise<void> {
  if (missingStartRecoveryInFlight) return;
  // An in-flight fetchMessages hydration owns snapshot recovery for this
  // conversation: its active-stream install applies the buffered backlog
  // itself, and a second concurrent fetch here would race it.
  if (useConversationStore.getState().messagesLoading) return;
  missingStartRecoveryInFlight = true;
  try {
    const snapshot = await api.fetchActiveStream(conversationId).catch((err: unknown) => {
      console.warn('[ConversationStore] missing-start snapshot recovery failed', err);
      return null;
    });
    const state = useConversationStore.getState();
    // The start frame arrived (or the view moved on) while fetching: the
    // normal event paths own the stream now. A failed fetch keeps the bounded
    // backlog so the next chunk can retry.
    if (receivedCurrentStreamStart || state.currentConversationId !== conversationId) {
      pendingRecoveryChunks = [];
      return;
    }
    if (!snapshot || resyncHoldActive) return;
    // A terminal event (completion/error) settles the stream while the
    // snapshot is in flight — the terminal state must win, never be
    // resurrected as a live-looking stream no event will ever finish.
    if (!state.isStreaming) {
      pendingRecoveryChunks = [];
      return;
    }
    const trackedMessageId = state.streamingMessageId ?? state.pendingAssistantMessageId;
    if (trackedMessageId && trackedMessageId !== snapshot.messageId) {
      // A different (newer) run owns the pipe; its own events are intact.
      pendingRecoveryChunks = [];
      return;
    }
    const heldChunks = pendingRecoveryChunks;
    pendingRecoveryChunks = [];
    installActiveStreamSnapshot(conversationId, snapshot, heldChunks, {
      replaceComponents: false,
    });
  } finally {
    missingStartRecoveryInFlight = false;
  }
}

/**
 * The server proved a replay discontinuity (`stream_resync_required`). For
 * the currently live run, the ordinary already-live hydration optimization
 * must not skip the repair: hold arriving deltas, force-install the
 * authoritative snapshot, then apply only deltas newer than it. Falls back to
 * the canonical message reload when no local run is being tracked — never a
 * partial replay over a proven gap.
 */
async function forcedResyncActiveStream(conversationId: string): Promise<void> {
  if (forcedResyncInFlight) return;
  forcedResyncInFlight = true;
  resyncHoldActive = true;
  resyncHoldConversationId = conversationId;
  try {
    const initial = useConversationStore.getState();
    const wasTrackingRun = (initial.streamingMessageId ?? initial.pendingAssistantMessageId) !== null;
    const snapshot = await api.fetchActiveStream(conversationId).catch((err: unknown) => {
      console.warn('[ConversationStore] forced resync snapshot fetch failed', err);
      return null;
    });
    resyncHoldActive = false;
    resyncHoldConversationId = null;
    const heldChunks = resyncHeldChunks;
    resyncHeldChunks = [];

    const state = useConversationStore.getState();
    if (state.currentConversationId !== conversationId) return;
    if (!snapshot) {
      void state.fetchMessages(conversationId);
      return;
    }
    const trackedMessageId = state.streamingMessageId ?? state.pendingAssistantMessageId;
    if (trackedMessageId === snapshot.messageId) {
      installActiveStreamSnapshot(conversationId, snapshot, heldChunks, {
        replaceComponents: true,
      });
      return;
    }
    if (!state.isStreaming && !wasTrackingRun) {
      // Not tracking any run: the canonical reload is the recovery surface
      // (it hydrates the active run from the same snapshot).
      void state.fetchMessages(conversationId);
    }
    // A different run is already tracked, or the tracked run completed or
    // moved on while fetching — those own their canonical state; leave them.
  } finally {
    resyncHoldActive = false;
    resyncHoldConversationId = null;
    forcedResyncInFlight = false;
  }
}

function cancelPendingStreamReconciliation(): void {
  if (pendingStreamReconcileTimer) clearTimeout(pendingStreamReconcileTimer);
  pendingStreamReconcileTimer = null;
  pendingStreamReconcileAttempts = 0;
  pendingStreamReconcileInFlight = false;
  pendingStreamReconcileTarget = null;
}

function schedulePendingStreamReconciliation(reconcile: () => Promise<void>): void {
  if (pendingStreamReconcileTimer || pendingStreamReconcileAttempts >= MAX_PENDING_STREAM_RECONCILE_ATTEMPTS) return;
  pendingStreamReconcileTimer = setTimeout(() => {
    pendingStreamReconcileTimer = null;
    void reconcile();
  }, PENDING_STREAM_RECONCILE_INTERVAL_MS);
}

function hasErrorComponent(message: { components?: Array<{ type: string }> }): boolean {
  return message.components?.some((component) => component.type === 'error') === true;
}

function isTransientReconciliationError(error: unknown): boolean {
  const status = parseApiError(error).statusCode;
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function upsertMessage(messages: Message[], message: Message): { messages: Message[]; inserted: boolean } {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return { messages: [...messages, message], inserted: true };

  const next = [...messages];
  next[index] = {
    ...next[index],
    ...message,
    reliabilityEvaluation: message.reliabilityEvaluation ?? next[index].reliabilityEvaluation,
    correctionWorkflow: message.correctionWorkflow ?? next[index].correctionWorkflow,
  };
  return { messages: next, inserted: false };
}

/**
 * Initialize component data with proper structure based on type.
 * Called on 'add' action.
 */
function initializeStreamingData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  if (type === 'chart') {
    // Backend sends chart data as an object with:
    // - data: array of data points (or nested object with data.data)
    // - chartData: sometimes array, sometimes empty string
    // - config: JSON string or object
    // - Other props: title, xAxisKey, yAxisKey, series, kind, etc.

    const parseJsonArray = (value: unknown): Record<string, unknown>[] => {
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return [];

      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    // Extract the actual data array
    let actualData: Record<string, unknown>[] = [];

    // Check if data.data is already an array (most common case from backend)
    if (Array.isArray(data.data)) {
      actualData = data.data;
    }
    // Check if data.data is a nested object with a data property
    else if (typeof data.data === 'object' && data.data !== null && 'data' in (data.data as Record<string, unknown>)) {
      const nested = (data.data as Record<string, unknown>).data;
      if (Array.isArray(nested)) {
        actualData = nested;
      }
    }
    // Fallback to chartData if it's an array
    else if (Array.isArray(data.chartData)) {
      actualData = data.chartData;
    } else {
      actualData = parseJsonArray(data.data) || parseJsonArray(data.chartData);
    }

    // Return the data structure with chartData set to the actual data array
    return {
      ...data,
      chartData: actualData,
      data: actualData,
    };
  }

  // All other types use data directly - queue/plan arrive fully formed
  return { ...data };
}

/**
 * Merge incoming data into existing component data based on type.
 * Called on 'update' action.
 */
function mergeStreamingData(type: string, existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'text': {
      if (incoming.guardrailDecision) {
        return { ...existing, ...incoming };
      }
      // Append content for streaming text types
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      const sentenceGap = /[.!?][\])"']?$/.test(existingContent) && /^\p{Lu}/u.test(newContent) ? ' ' : '';
      return {
        ...existing,
        content: existingContent + sentenceGap + newContent,
      };
    }
    case 'agentActivity':
      return { ...existing, ...incoming };
    case 'code': {
      // Append content, preserve language/filename from first chunk
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      return {
        ...existing,
        content: existingContent + newContent,
        // Only update language/filename if incoming has non-empty values
        language: (incoming.language as string) || existing.language,
        filename: (incoming.filename as string) || existing.filename,
      };
    }
    case 'queue':
    case 'plan':
    case 'checkpoint':
    case 'task':
    case 'error':
    case 'citation':
      // Charts and other structured components replace the full payload on update.
      return { ...incoming };
    case 'toolActivity':
      // Terminal tool updates only include status. Retain the arguments from
      // the initial event so the live debug pane matches persisted history.
      const existingStatus = (existing.status as string) || 'running';
      const incomingStatus = (incoming.status as string) || existingStatus;
      const existingIsTerminal = existingStatus === 'completed' || existingStatus === 'failed' || existingStatus === 'stopped';
      const merged: Record<string, unknown> = {
        ...existing,
        ...incoming,
        toolName: (incoming.toolName as string) || (existing.toolName as string) || '',
        status: existingIsTerminal ? existingStatus : incomingStatus,
        paramsJson: (incoming.paramsJson as string) || (existing.paramsJson as string) || '',
        startedAt: (incoming.startedAt as string) || (existing.startedAt as string) || '',
        ...(incoming.summary || existing.summary
          ? {
              summary: (incoming.summary as string) || (existing.summary as string),
            }
          : {}),
        ...(incoming.renderKind || existing.renderKind
          ? {
              renderKind: existing.renderKind && existing.renderKind !== 'generic' ? existing.renderKind : incoming.renderKind || existing.renderKind || 'generic',
            }
          : {}),
      };
      return merged;
    case 'chart': {
      // For charts, data is an object with properties (title, data, config, etc.)
      // and chartData is the actual array of data points
      const parseJsonArray = (value: unknown): Record<string, unknown>[] => {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string') return [];

        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      const incomingChartData = parseJsonArray(incoming.chartData);
      const existingChartData = parseJsonArray(existing.chartData);

      // Determine the best chart data array to use
      let finalChartData: Record<string, unknown>[] = [];
      if (Array.isArray(incomingChartData) && incomingChartData.length > 0) {
        finalChartData = incomingChartData;
      } else if (Array.isArray(existingChartData) && existingChartData.length > 0) {
        finalChartData = existingChartData;
      }

      // For chart data object, merge properties with incoming taking precedence
      const chartDataObj =
        typeof incoming.data === 'object' && incoming.data !== null
          ? {
              ...(typeof existing.data === 'object' && existing.data !== null ? (existing.data as Record<string, unknown>) : {}),
              ...(incoming.data as Record<string, unknown>),
            }
          : typeof existing.data === 'object' && existing.data !== null
            ? (existing.data as Record<string, unknown>)
            : {};

      return {
        ...existing,
        ...incoming,
        data: chartDataObj,
        chartData: finalChartData,
        kind: (incoming.kind as string) || (existing.kind as string) || 'bar',
        layout: (incoming.layout as string) || (existing.layout as string) || 'horizontal',
      };
    }
    case 'sandbox':
      // Sandbox: merge code from first chunk with output/error from update
      // Preserve non-empty values from existing when incoming has empty values
      // For outputAvailable: if incoming explicitly sets it to true, use true; otherwise keep existing
      return {
        code: (incoming.code as string) || (existing.code as string) || '',
        output: (incoming.output as string) || (existing.output as string) || '',
        error: (incoming.error as string) || (existing.error as string) || '',
        outputAvailable: incoming.outputAvailable === true || existing.outputAvailable === true,
      };
    default:
      return { ...existing, ...incoming };
  }
}

interface ConversationState {
  // Conversation list - flat array for simpler CRUD
  conversations: Conversation[];
  conversationSummaries: ConversationSummary[];
  conversationsTotal: number;
  conversationsHasMore: boolean;
  conversationsCursor: string | null;
  conversationsLoading: boolean;
  historyPanelOpen: boolean;

  // Current conversation
  currentConversationId: string | null;
  currentConversation: Conversation | null;
  conversationLoading: boolean;

  // Messages for current conversation - flat array, sorted oldest-to-newest
  messages: Message[];
  messagesTotal: number;
  messagesLoading: boolean;
  messagesLoadingOlder: boolean;
  messagesHasMore: boolean;
  messagesCursor: string | null;
  conversationUsage: ConversationUsageMetrics | null;

  // Streaming state
  streamingConversationId: string | null;
  streamingMessageId: string | null;
  streamingQuestionMessageId: string | null;
  streamingComponents: StreamingComponent[];
  isStreaming: boolean;

  // Latency instrumentation first-paint tracking (runtime-only, not persisted)
  pendingLatencyPaint: PendingLatencyPaint | null;

  // Send state
  isAwaitingFirstChunk: boolean;
  awaitingConversationId: string | null;
  pendingAssistantMessageId: string | null;
  pendingTerminalErrorKey: string | null;
  earlyStreamErrors: Map<string, StreamErrorEvent>;
  inFlightSendConversations: Set<string>;
  optimisticMessages: Message[];

  // SSE connection state
  sseStatus: SSEConnectionStatus;
  sseError: string | null;

  // Branch navigation state
  branchCache: Map<string, Message[]>; // userMessageId → AI branches
  activeBranches: Map<string, string>; // userMessageId → active AI messageId
  editingMessageId: string | null;
  replyingToMessage: Message | null;

  // Error state
  criticalError: { code: string; message: string } | null;
  inputDisabled: boolean;

  // Model selection
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;

  // Workspace selection
  selectedWorkspaceIds: string[];
  selectedSemanticModelId: string | null;

  // Selected connector repository for the current conversation
  selectedConnectorRepo: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  } | null;

  // Deep search toggle
  deepSearchEnabled: boolean;

  // Access to connectors in the Web Search category
  webConnectorAccessEnabled: boolean;

  // Selected skill IDs for the current conversation (applied to every message)
  selectedSkillIds: string[];

  // Stream state cache for background conversations
  streamingStateCache: Map<string, CachedStreamingState>;

  // Typewriter state for name generation
  typewriterConversationId: string | null;
  typewriterName: string | null;

  // Unread mentions counter
  unreadMentions: number;
  mentionNavigationLock: boolean;

  // Project-scoped conversation lists (separate from the main history list)
  projectConversations: Record<string, Conversation[]>;
  projectConversationsLoading: Record<string, boolean>;

  // Actions - Conversations
  fetchConversations: (params?: { reset?: boolean; limit?: number; search?: string; projectId?: string | 'none'; searchScope?: 'title' | 'fulltext' }) => Promise<void>;
  fetchProjectConversations: (projectId: string, options?: { limit?: number }) => Promise<void>;
  createConversation: (data?: { title?: string; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }>; ownerJob?: string; projectId?: string }) => Promise<Conversation>;
  updateConversation: (
    id: string,
    data: {
      title?: string;
      isArchived?: boolean;
      workspaces?: string[];
      participantEmails?: string[];
      participants?: Array<{ email: string; job?: string }>;
      projectId?: string | null;
    },
  ) => Promise<void>;
  moveConversationToProject: (id: string, projectId: string | null) => Promise<void>;
  detachConversationsFromProject: (projectId: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  claimCurrentConversation: (
    id: string,
    conversation?: Conversation,
    selections?: {
      modelId?: string;
      semanticModelId?: string;
      workspaceIds?: string[];
    },
  ) => void;
  setCurrentConversation: (id: string) => Promise<void>;

  // Actions - History Panel
  setHistoryPanelOpen: (open: boolean) => void;
  toggleHistoryPanel: () => void;

  // Actions - Messages
  fetchMessages: (conversationId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (conversationId: string, payload: SendMessagePayload) => Promise<void>;
  updateFeedback: (conversationId: string, messageId: string, feedback: 'like' | 'dislike' | null) => Promise<void>;
  regenerateMessage: (conversationId: string, messageId: string) => Promise<void>;
  reportMessage: (conversationId: string, messageId: string, payload: CreateReportPayload) => Promise<void>;
  setReplyingToMessage: (message: Message | null) => void;
  clearReplyingTo: () => void;

  // Actions - Branch navigation
  fetchBranches: (conversationId: string, userMessageId: string, selectLatest?: boolean) => Promise<void>;
  setActiveBranch: (userMessageId: string, aiMessageId: string) => void;
  navigateBranch: (userMessageId: string, direction: 'prev' | 'next') => void;
  setEditingMessage: (messageId: string | null) => void;
  updateUserMessage: (conversationId: string, messageId: string, content: string, agentIds?: string[], memberIds?: string[]) => Promise<void>;

  // Actions - Stream
  stopStream: () => Promise<void>;
  onStreamStart: (event: StreamStartEvent) => void;
  onStreamChunk: (event: StreamChunkEvent) => void;
  onStreamComplete: (event: StreamCompleteEvent) => void;
  onStreamError: (event: StreamErrorEvent) => void;
  recordLatencyFirstPaint: () => void;
  reportPendingLatency: (conversationId: string, messageId: string) => void;
  onConversationNameGenerated: (event: ConversationNameGeneratedEvent) => void;
  onMessageCreated: (event: MessageCreatedEvent) => void;
  onMessageUpdated: (event: MessageUpdatedEvent) => void;
  onStreamResyncRequired: (event: StreamResyncRequiredEvent) => void;
  reconcilePendingStream: () => Promise<void>;
  onMentionCreated: (event: { conversationId: string; messageId: string; userId: string }) => void;
  clearTypewriter: () => void;
  clearUnreadMentions: () => void;
  markMentionSeen: (conversationId: string, messageId: string) => Promise<void>;
  setMentionNavigationLock: (locked: boolean) => void;

  // Actions - SSE Connection
  onSSEConnected: () => void;
  onConnectionFailed: (reason: string) => void;
  dismissSSEError: () => void;

  // Actions - Error
  dismissCriticalError: () => void;
  retryLastMessage: () => Promise<void>;

  // Model selection
  setSelectedModelId: (modelId: string | null) => void;
  setSelectedReasoningEffort: (effort: string | null) => void;

  // Workspace selection
  setSelectedWorkspaceIds: (workspaceIds: string[]) => void;
  resetSelectedWorkspaceIds: () => void;
  setSelectedSemanticModelId: (modelId: string | null) => void;

  // Connector repository selection
  setSelectedConnectorRepo: (
    repo: {
      connectorId: string;
      connectorName: string;
      repoId: string;
      repoName: string;
      repoUrl?: string;
    } | null,
  ) => void;

  // Deep search toggle
  setDeepSearchEnabled: (enabled: boolean) => void;

  // Web Search connector access toggle
  setWebConnectorAccessEnabled: (enabled: boolean) => void;

  // Skill selection (applied to every message in the conversation)
  setSelectedSkillIds: (skillIds: string[]) => void;
  toggleSelectedSkill: (skillId: string) => void;
  clearSelectedSkills: () => void;
  persistSelectedSkills: () => void;

  // Cleanup
  clearMessages: () => void;
  clearAll: () => void;
}

let lastConversationListParams: Parameters<ConversationState['fetchConversations']>[0] = {};

export const useConversationStore = create<ConversationState>()(
  devtools(
    (set, get) => ({
      // Initial state - flat array for conversations
      conversations: [],
      conversationSummaries: [],
      conversationsTotal: 0,
      conversationsHasMore: false,
      conversationsCursor: null,
      conversationsLoading: false,
      projectConversations: {},
      projectConversationsLoading: {},
      historyPanelOpen: typeof window !== 'undefined' ? localStorage.getItem('historyPanelOpen') === 'true' : false,

      currentConversationId: null,
      currentConversation: null,
      conversationLoading: false,

      messages: [],
      messagesTotal: 0,
      messagesLoading: false,
      messagesLoadingOlder: false,
      messagesHasMore: false,
      messagesCursor: null,
      conversationUsage: null,

      streamingConversationId: null,
      streamingMessageId: null,
      streamingQuestionMessageId: null,
      streamingComponents: [],
      isStreaming: false,
      pendingLatencyPaint: null,

      isAwaitingFirstChunk: false,
      awaitingConversationId: null,
      pendingAssistantMessageId: null,
      pendingTerminalErrorKey: null,
      earlyStreamErrors: new Map(),
      inFlightSendConversations: new Set(),
      optimisticMessages: [],

      sseStatus: 'disconnected' as SSEConnectionStatus,
      sseError: null,

      branchCache: new Map(),
      activeBranches: new Map(),
      editingMessageId: null,
      replyingToMessage: null,

      criticalError: null,
      inputDisabled: false,

      selectedModelId: null,
      selectedReasoningEffort: null,
      selectedWorkspaceIds: [],
      selectedSemanticModelId: null,
      selectedConnectorRepo: null,
      deepSearchEnabled: false,
      webConnectorAccessEnabled: true,
      selectedSkillIds: [],

      streamingStateCache: new Map(),

      typewriterConversationId: null,
      typewriterName: null,
      mentionNavigationLock: false,

      // ===== Conversation Actions =====

      fetchConversations: async (params?: { reset?: boolean; limit?: number; search?: string; projectId?: string | 'none'; searchScope?: 'title' | 'fulltext' }) => {
        const requestSequence = ++conversationListRequestSequence;
        const reset = params?.reset ?? false;
        const limit = params?.limit || DEFAULT_CONVERSATIONS_LIMIT;
        lastConversationListParams = { ...params, reset: true };

        if (reset) {
          set({ conversationsCursor: null, conversationsLoading: true });
        } else {
          set({ conversationsLoading: true });
        }

        try {
          const state = get();
          const result = await api.fetchConversations({
            mode: 'cursor',
            cursor: reset ? undefined : (state.conversationsCursor ?? undefined),
            limit,
            search: params?.search,
            projectId: params?.projectId,
            searchScope: params?.searchScope,
          });
          if (requestSequence !== conversationListRequestSequence) return;

          set((s) => {
            const combined = reset ? result.items : [...s.conversationSummaries, ...result.items];

            // Dedupe by ID (safety for edge cases)
            const seen = new Set<string>();
            const deduped = combined.filter((c) => {
              if (seen.has(c.id)) return false;
              seen.add(c.id);
              return true;
            });

            return {
              conversationSummaries: deduped,
              conversationsTotal: deduped.length,
              conversationsHasMore: result.hasMore ?? false,
              conversationsCursor: result.nextCursor ?? null,
              conversationsLoading: false,
            };
          });
        } catch (err) {
          if (requestSequence !== conversationListRequestSequence) return;
          set({ conversationsLoading: false });
          toast.error(translateConversation('toasts.conversation.loadListError'));
          console.error('[ConversationStore] fetchConversations error:', err);
        }
      },

      fetchProjectConversations: async (projectId, options) => {
        const limit = options?.limit ?? 50;
        set((s) => ({
          projectConversationsLoading: {
            ...s.projectConversationsLoading,
            [projectId]: true,
          },
        }));
        try {
          const result = await api.fetchConversations({
            page: 1,
            limit,
            projectId,
          });
          set((s) => ({
            projectConversations: {
              ...s.projectConversations,
              [projectId]: result.items,
            },
            projectConversationsLoading: {
              ...s.projectConversationsLoading,
              [projectId]: false,
            },
          }));
        } catch (err) {
          set((s) => ({
            projectConversationsLoading: {
              ...s.projectConversationsLoading,
              [projectId]: false,
            },
          }));
          toast.error(translateConversation('toasts.conversation.loadListError'));
          console.error('[ConversationStore] fetchProjectConversations error:', err);
        }
      },

      createConversation: async (data) => {
        try {
          const conversation = await api.createConversation(data);

          set((s) => {
            const next: Partial<ConversationState> = {
              conversations: [conversation, ...s.conversations],
              conversationSummaries: [
                {
                  ...conversation,
                  isGroup: Boolean(conversation.groupMeta?.isGroup),
                  unseenMentionCount: 0,
                  runtimeMode: conversation.runtimeMode ?? 'standard',
                  runtimePurpose: conversation.runtimePurpose ?? 'chat',
                },
                ...s.conversationSummaries,
              ],
              conversationsTotal: s.conversationsTotal + 1,
            };
            if (conversation.projectId && s.projectConversations[conversation.projectId]) {
              next.projectConversations = {
                ...s.projectConversations,
                [conversation.projectId]: [conversation, ...s.projectConversations[conversation.projectId]],
              };
            }
            return next;
          });
          void get().fetchConversations(lastConversationListParams);

          return conversation;
        } catch (err) {
          toast.error(translateConversation('toasts.conversation.createError'));
          throw err;
        }
      },

      updateConversation: async (id, data) => {
        const previousConversations = get().conversations;
        const previousSummaries = get().conversationSummaries;
        const previousProjectConversations = get().projectConversations;

        // Optimistic update — also reflect in any project list that contains it
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...data } : c)),
          conversationSummaries: s.conversationSummaries.map((c) => (c.id === id ? { ...c, ...data } : c)),
          projectConversations: mapProjectLists(s.projectConversations, (c) => (c.id === id ? { ...c, ...data } : c)),
          currentConversation: s.currentConversation?.id === id ? { ...s.currentConversation, ...data } : s.currentConversation,
        }));

        try {
          const updated = await api.updateConversation(id, data);
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
            conversationSummaries: s.conversationSummaries.map((c) => (c.id === id ? { ...c, ...updated } : c)),
            projectConversations: mapProjectLists(s.projectConversations, (c) => (c.id === id ? updated : c)),
            currentConversation: s.currentConversation?.id === id ? updated : s.currentConversation,
          }));
          void get().fetchConversations(lastConversationListParams);
        } catch (err) {
          set({
            conversations: previousConversations,
            conversationSummaries: previousSummaries,
            projectConversations: previousProjectConversations,
          });
          toast.error(translateConversation('toasts.conversation.updateError'));
          throw err;
        }
      },

      moveConversationToProject: async (id, projectId) => {
        const state = get();
        const previousConversations = state.conversations;
        const previousSummaries = state.conversationSummaries;
        const previousProjectConversations = state.projectConversations;

        // Find the conversation in any list to capture its current shape
        const conv =
          state.conversations.find((c) => c.id === id) ??
          Object.values(state.projectConversations)
            .flat()
            .find((c) => c.id === id) ??
          (state.currentConversation?.id === id ? state.currentConversation : null);

        const sourceProjectId = conv?.projectId ?? null;
        const optimistic: Conversation | null = conv ? { ...conv, projectId } : null;

        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, projectId } : c)),
          conversationSummaries: s.conversationSummaries.map((c) => (c.id === id ? { ...c, projectId } : c)),
          projectConversations: rebalanceProjectLists(s.projectConversations, id, sourceProjectId, projectId, optimistic),
          currentConversation: s.currentConversation?.id === id ? { ...s.currentConversation, projectId } : s.currentConversation,
        }));

        try {
          const updated = await api.updateConversation(id, { projectId });
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
            conversationSummaries: s.conversationSummaries.map((c) => (c.id === id ? { ...c, ...updated } : c)),
            projectConversations: rebalanceProjectLists(s.projectConversations, id, sourceProjectId, projectId, updated),
            currentConversation: s.currentConversation?.id === id ? updated : s.currentConversation,
          }));
          void get().fetchConversations(lastConversationListParams);
        } catch (err) {
          set({
            conversations: previousConversations,
            conversationSummaries: previousSummaries,
            projectConversations: previousProjectConversations,
          });
          toast.error(translateConversation('toasts.conversation.updateError'));
          throw err;
        }
      },

      detachConversationsFromProject: (projectId) => {
        set((s) => {
          const { [projectId]: _removed, ...remainingLists } = s.projectConversations;
          const { [projectId]: _removedLoading, ...remainingLoading } = s.projectConversationsLoading;
          return {
            conversations: s.conversations.map((c) => (c.projectId === projectId ? { ...c, projectId: null } : c)),
            conversationSummaries: s.conversationSummaries.map((c) => (c.projectId === projectId ? { ...c, projectId: null } : c)),
            projectConversations: remainingLists,
            projectConversationsLoading: remainingLoading,
            currentConversation: s.currentConversation?.projectId === projectId ? { ...s.currentConversation, projectId: null } : s.currentConversation,
          };
        });
      },

      deleteConversation: async (id) => {
        const state = get();
        const previousConversations = state.conversations;
        const previousSummaries = state.conversationSummaries;
        const previousProjectConversations = state.projectConversations;
        const previousTotal = state.conversationsTotal;

        // Optimistic removal from both lists
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          conversationSummaries: s.conversationSummaries.filter((c) => c.id !== id),
          projectConversations: filterProjectLists(s.projectConversations, (c) => c.id !== id),
          conversationsTotal: Math.max(0, s.conversationsTotal - 1),
          currentConversation: s.currentConversation?.id === id ? null : s.currentConversation,
          currentConversationId: s.currentConversationId === id ? null : s.currentConversationId,
        }));

        try {
          await api.deleteConversation(id);
          void get().fetchConversations(lastConversationListParams);
        } catch (err) {
          set({
            conversations: previousConversations,
            conversationSummaries: previousSummaries,
            projectConversations: previousProjectConversations,
            conversationsTotal: previousTotal,
          });
          toast.error(translateConversation('toasts.conversation.deleteError'));
          throw err;
        }
      },

      claimCurrentConversation: (id, conversation, selections) => {
        const cached = conversation ?? get().conversations.find((candidate) => candidate.id === id) ?? null;
        set({
          currentConversationId: id,
          currentConversation: cached,
          conversationLoading: false,
          selectedSkillIds: cached?.selectedSkills ?? [],
          selectedModelId: selections?.modelId ?? null,
          selectedSemanticModelId: selections?.semanticModelId ?? null,
          selectedReasoningEffort: null,
          selectedWorkspaceIds: selections?.workspaceIds ?? cached?.workspaces ?? [],
        });
      },

      setCurrentConversation: async (id) => {
        const requestSequence = ++currentConversationRequestSequence;
        const isSwitchingConversation = get().currentConversationId !== id;
        set({
          conversationLoading: true,
          currentConversationId: id,
          ...(isSwitchingConversation ? { selectedModelId: null, selectedSemanticModelId: null } : {}),
          currentConversation: null,
          ...(isSwitchingConversation ? { selectedModelId: null, selectedReasoningEffort: null } : {}),
        });
        try {
          const conversation = await api.fetchConversation(id);
          if (requestSequence !== currentConversationRequestSequence || get().currentConversationId !== id) return;
          // Restore the skills selected for this conversation (persisted server-side)
          // so they survive a page refresh and conversation switches.
          set({
            currentConversation: conversation,
            conversationLoading: false,
            selectedSkillIds: conversation.selectedSkills ?? [],
            selectedWorkspaceIds: conversation.workspaces ?? [],
          });
        } catch (err) {
          if (requestSequence !== currentConversationRequestSequence || get().currentConversationId !== id) return;
          set({ currentConversation: null, conversationLoading: false });
          console.error('[ConversationStore] setCurrentConversation error:', err);
        }
      },

      // ===== Message Actions =====

      fetchMessages: async (conversationId) => {
        cancelPendingStreamReconciliation();
        const requestSequence = ++currentMessagesRequestSequence;
        const existingStream = get();
        if (!existingStream.isStreaming || existingStream.streamingConversationId !== conversationId) {
          currentRevisionStreamKey = null;
          currentStreamRevision = 0;
          receivedCurrentStreamStart = false;
          pendingRecoveryChunks = [];
        }
        set({
          messagesLoading: true,
          messagesLoadingOlder: false,
          messages: [],
          messagesHasMore: false,
          messagesCursor: null,
          conversationUsage: null,
          branchCache: new Map(),
          activeBranches: new Map(),
        });

        try {
          const result = await api.fetchMessages(conversationId, {
            mode: 'cursor',
            limit: DEFAULT_MESSAGES_LIMIT,
          });
          if (requestSequence !== currentMessagesRequestSequence || get().currentConversationId !== conversationId) return;

          const messages = result.items || [];

          // Find the last user message's modelId
          let lastUserModelId: string | null = null;
          let lastUserReasoningEffort: string | null = null;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].conversationType === 'user' && messages[i].modelId) {
              lastUserModelId = messages[i].modelId!;
              lastUserReasoningEffort = messages[i].reasoningEffort ?? null;
              break;
            }
          }

          const [activeStream] = await Promise.all([
            api.fetchActiveStream(conversationId).catch((err) => {
              console.error('[ConversationStore] active stream recovery error:', err);
              return null;
            }),
          ]);
          if (requestSequence !== currentMessagesRequestSequence || get().currentConversationId !== conversationId) return;

          const newBranchCache = new Map(get().branchCache);
          const newActiveBranches = new Map(get().activeBranches);
          for (const [userMessageId, branches] of Object.entries(result.branchesByQuestion ?? {})) {
            newBranchCache.set(userMessageId, branches);
            if (!newActiveBranches.has(userMessageId) && branches.length > 0) {
              newActiveBranches.set(userMessageId, branches[branches.length - 1].id);
            }
          }

          let hydratedMessages = messages;
          set((s) => {
            const completedDuringHydration = s.messages.filter((message) => message.isComplete === true);
            const completedById = new Map(completedDuringHydration.map((message) => [message.id, message]));
            hydratedMessages = messages.map((message) => completedById.get(message.id) ?? message);
            for (const message of completedDuringHydration) {
              if (!hydratedMessages.some((candidate) => candidate.id === message.id)) hydratedMessages.push(message);
            }
            return {
              messages: hydratedMessages,
              messagesTotal: Math.max(result.total || 0, hydratedMessages.length),
              messagesHasMore: result.hasMore ?? (result.totalPages || 1) > 1,
              messagesCursor: result.nextCursor ?? null,
              messagesLoading: false,
              conversationUsage: result.conversationUsage ?? null,
              ...(lastUserModelId ? { selectedModelId: lastUserModelId } : {}),
              ...(lastUserModelId ? { selectedReasoningEffort: lastUserReasoningEffort } : {}),
              branchCache: newBranchCache,
              activeBranches: newActiveBranches,
            };
          });

          // Restore cached streaming state if this conversation is still streaming
          const cachedState = get().streamingStateCache.get(conversationId);
          if (cachedState) {
            // Remove from cache
            const newCache = new Map(get().streamingStateCache);
            newCache.delete(conversationId);

            // A terminal SSE event may have been missed while this conversation
            // was in the background. Persistence wins over stale live cache.
            const persistedMessage = cachedState.streamingMessageId ? hydratedMessages.find((message) => message.id === cachedState.streamingMessageId) : undefined;
            if (persistedMessage?.isComplete) {
              streamingBuffer.clear();
              set({
                isStreaming: false,
                streamingConversationId: null,
                streamingMessageId: null,
                streamingQuestionMessageId: null,
                streamingComponents: [],
                isAwaitingFirstChunk: false,
                awaitingConversationId: null,
                pendingAssistantMessageId: null,
                pendingTerminalErrorKey: hasErrorComponent(persistedMessage) ? `${conversationId}:${persistedMessage.id}` : null,
                streamingStateCache: newCache,
              });
              return;
            }

            // Set up the buffer flush callback so new chunks render live
            streamingBuffer.clear();
            streamingBuffer.setFlushCallback((chunks) => {
              set((s) => {
                const components = applyChunksToComponents(s.streamingComponents, chunks);
                const nextState: Partial<ConversationState> = {
                  streamingComponents: components,
                };
                if (components.length > 0 && s.isAwaitingFirstChunk) {
                  nextState.isAwaitingFirstChunk = false;
                }
                return nextState;
              });
            });

            set({
              isStreaming: cachedState.streamingMessageId !== '',
              streamingConversationId: conversationId,
              streamingMessageId: cachedState.streamingMessageId || null,
              streamingQuestionMessageId: cachedState.streamingQuestionMessageId,
              streamingComponents: cachedState.streamingComponents,
              isAwaitingFirstChunk: cachedState.isAwaitingFirstChunk,
              awaitingConversationId: cachedState.isAwaitingFirstChunk ? conversationId : null,
              streamingStateCache: newCache,
            });
          } else if (activeStream) {
            const placeholder = hydratedMessages.find((message) => message.id === activeStream.messageId);
            const current = get();
            const alreadyLive = receivedCurrentStreamStart && current.isStreaming && current.streamingConversationId === conversationId && current.streamingMessageId === activeStream.messageId;

            if (!placeholder?.isComplete && !alreadyLive) {
              streamingBuffer.setFlushCallback((chunks) => {
                set((s) => ({
                  streamingComponents: applyChunksToComponents(s.streamingComponents, chunks),
                  ...(s.isAwaitingFirstChunk && chunks.length > 0
                    ? {
                        isAwaitingFirstChunk: false,
                        awaitingConversationId: null,
                      }
                    : {}),
                }));
              });

              const snapshotRevision = activeStream.revision ?? 0;
              const newerChunks = pendingRecoveryChunks.filter((chunk) => chunk.revision === undefined || chunk.revision > snapshotRevision);
              pendingRecoveryChunks = [];
              set(() => {
                const components = applyChunksToComponents(activeStream.components, newerChunks);
                return {
                  isStreaming: true,
                  streamingConversationId: conversationId,
                  streamingMessageId: activeStream.messageId,
                  streamingQuestionMessageId: placeholder?.questionMessageId ?? null,
                  pendingAssistantMessageId: activeStream.messageId,
                  streamingComponents: components,
                  isAwaitingFirstChunk: components.length === 0,
                  awaitingConversationId: components.length === 0 ? conversationId : null,
                };
              });
              const snapshotKey = `${conversationId}:${activeStream.messageId}`;
              if (currentRevisionStreamKey !== snapshotKey) currentStreamRevision = 0;
              currentRevisionStreamKey = snapshotKey;
              currentStreamRevision = Math.max(currentStreamRevision, snapshotRevision);
              receivedCurrentStreamStart = true;
              streamingBuffer.discardThrough(snapshotRevision);
              streamingBuffer.flush();
            }
          }

          const pendingMessage = activeStream ? hydratedMessages.find((message) => message.id === activeStream.messageId) : [...hydratedMessages].reverse().find((message) => message.conversationType === 'ai' && message.isStreaming === true && message.isComplete !== true);
          if (pendingMessage && !pendingMessage.isComplete) {
            const state = get();
            if (state.streamingMessageId !== pendingMessage.id) {
              set({
                isStreaming: true,
                streamingConversationId: conversationId,
                streamingMessageId: pendingMessage.id,
                pendingAssistantMessageId: pendingMessage.id,
              });
            }
            await get().reconcilePendingStream();
          }
        } catch (err) {
          if (requestSequence !== currentMessagesRequestSequence || get().currentConversationId !== conversationId) return;
          set({ messagesLoading: false });
          toast.error(translateConversation('toasts.messages.loadError'));
          console.error('[ConversationStore] fetchMessages error:', err);
        }
      },

      loadMoreMessages: async () => {
        const state = get();
        // Don't load more if: no conversation, no more messages, already loading older, or initial load in progress
        if (!state.currentConversationId || !state.messagesHasMore || state.messagesLoadingOlder || state.messagesLoading) {
          return;
        }

        set({ messagesLoadingOlder: true });
        const conversationId = state.currentConversationId;
        const requestSequence = currentMessagesRequestSequence;

        try {
          const result = await api.fetchMessages(conversationId, {
            mode: 'cursor',
            cursor: state.messagesCursor ?? undefined,
            limit: DEFAULT_MESSAGES_LIMIT,
          });
          if (requestSequence !== currentMessagesRequestSequence || get().currentConversationId !== conversationId) return;

          set((s) => {
            // Prepend older messages, dedupe by ID
            const existingIds = new Set(s.messages.map((m) => m.id));
            const newMessages = (result.items || []).filter((m) => !existingIds.has(m.id));
            const branchCache = new Map(s.branchCache);
            const activeBranches = new Map(s.activeBranches);
            for (const [userMessageId, branches] of Object.entries(result.branchesByQuestion ?? {})) {
              branchCache.set(userMessageId, branches);
              if (!activeBranches.has(userMessageId) && branches.length > 0) {
                activeBranches.set(userMessageId, branches[branches.length - 1].id);
              }
            }

            return {
              messages: [...newMessages, ...s.messages], // Prepend older
              messagesHasMore: result.hasMore ?? false,
              messagesCursor: result.nextCursor ?? null,
              messagesLoadingOlder: false,
              branchCache,
              activeBranches,
            };
          });
        } catch (err) {
          set({ messagesLoadingOlder: false });
          toast.error(translateConversation('toasts.messages.loadError'));
          console.error('[ConversationStore] loadMoreMessages error:', err);
        }
      },

      sendMessage: async (conversationId, payload) => {
        // Each turn owns a fresh client-metrics window (Phase 0 telemetry). The
        // generation bump also invalidates a deferred completion snapshot from
        // the previous turn so it cannot wipe this turn's early counters.
        clientMetricsGeneration += 1;
        streamMetrics.reset();
        const tempId = `temp-${Date.now()}`;
        const optimisticMsg: Message = {
          id: tempId,
          conversationId,
          conversationType: 'user',
          content: payload.content,
          modelId: payload.modelId,
          reasoningEffort: payload.reasoningEffort,
          interaction: payload.interaction,
          interactions: payload.interactions,
          attachedFileIds: payload.attachedFileIds,
          attachedFiles: payload.attachedFiles,
          createdAt: new Date().toISOString(),
        };

        // Optimistic add
        set((s) => {
          const inFlightSendConversations = new Set(s.inFlightSendConversations);
          inFlightSendConversations.add(conversationId);
          return {
            isAwaitingFirstChunk: !payload.memberIds?.length,
            awaitingConversationId: !payload.memberIds?.length ? conversationId : null,
            optimisticMessages: [...s.optimisticMessages, optimisticMsg],
            inFlightSendConversations,
          };
        });

        // Persist the conversation's skill selection (covers new conversations,
        // where toggles happened before the conversation existed).
        if (payload.skillIds?.length) {
          api.updateConversation(conversationId, { skillIds: payload.skillIds }).catch((err) => console.error('[ConversationStore] persist skills on send error:', err));
        }

        try {
          // Strip attachedFiles (frontend-only for optimistic display) before sending to API
          const { attachedFiles: _, ...apiPayload } = payload;
          // Phase 0 telemetry: store entry → POST dispatch (no connection wait on this span).
          const sendStartedAt = performance.now();
          // POST starts immediately; the shared SSE pipe connects/reconnects in
          // parallel and the server replays any events it misses — the old
          // awaited readiness gate is gone by design (replay-safe streaming).
          conversationStreamService.ensureConnected();
          streamMetrics.recordClickToPost(performance.now() - sendStartedAt);
          const result = await api.sendMessage(conversationId, apiPayload);

          // Replace optimistic message with real user message (with deduplication).
          // Patch sticky taggedAgentIds when the set actually changes.
          set((s) => {
            const alreadyExists = s.messages.some((m) => m.id === result.userMessage.id);
            // Insert (not append): SSE may already have delivered AI answers
            // created after this user message while the POST was in flight.
            const nextMessages = alreadyExists ? s.messages : insertMessageChronologically(s.messages, result.userMessage);
            const nextTaggedAgentIds = result.userMessage.agentIds?.length ? result.userMessage.agentIds : undefined;
            const prevTagged = s.currentConversation?.taggedAgentIds;
            const taggedChanged = !!nextTaggedAgentIds && s.currentConversation?.id === conversationId && (prevTagged?.length !== nextTaggedAgentIds.length || nextTaggedAgentIds.some((agentId, i) => agentId !== prevTagged[i]));
            const inFlightSendConversations = new Set(s.inFlightSendConversations);
            inFlightSendConversations.delete(conversationId);

            return {
              messages: nextMessages,
              optimisticMessages: s.optimisticMessages.filter((m) => m.id !== tempId),
              messagesTotal: alreadyExists ? s.messagesTotal : s.messagesTotal + 1,
              selectedModelId: payload.modelId || s.selectedModelId,
              currentConversation: taggedChanged
                ? {
                    ...s.currentConversation!,
                    taggedAgentIds: nextTaggedAgentIds,
                  }
                : s.currentConversation,
              pendingAssistantMessageId: result.aiMessageId ?? s.pendingAssistantMessageId,
              inFlightSendConversations,
            };
          });

          const earlyError = get().earlyStreamErrors.get(conversationId);
          if (earlyError) {
            const earlyStreamErrors = new Map(get().earlyStreamErrors);
            earlyStreamErrors.delete(conversationId);
            set({ earlyStreamErrors });
            if (earlyError.messageId === result.aiMessageId) get().onStreamError(earlyError);
          }
        } catch (err) {
          // Rollback optimistic message
          const apiError = parseApiError(err);
          set((s) => ({
            isAwaitingFirstChunk: false,
            awaitingConversationId: null,
            optimisticMessages: s.optimisticMessages.filter((m) => m.id !== tempId),
            earlyStreamErrors: new Map([...s.earlyStreamErrors].filter(([errorConversationId]) => errorConversationId !== conversationId)),
            inFlightSendConversations: new Set([...s.inFlightSendConversations].filter((sendConversationId) => sendConversationId !== conversationId)),
          }));

          // Handle MODEL_INACTIVE error - refresh models and clear selection
          if (apiError.code === ErrorCode.MODEL_INACTIVE) {
            toast.error(translateConversation('toasts.model.unavailableTitle'), {
              description: translateConversation('toasts.model.unavailableDescription'),
            });
            // Refresh models list to get updated active models
            useModelsStore.getState().refreshModels();
            // Clear selected model so it falls back to default
            set({ selectedModelId: null, selectedReasoningEffort: null });
          } else {
            toast.error(translateConversation('toasts.messages.sendError'), {
              description: apiError.message,
            });
          }
          throw err;
        }
      },

      updateFeedback: async (conversationId, messageId, feedback) => {
        // Optimistic update
        set((s) => ({
          messages: s.messages.map((m) => (m.id === messageId ? { ...m, feedback: feedback || undefined } : m)),
        }));

        try {
          await api.updateFeedback(conversationId, messageId, feedback);
        } catch (err) {
          // Rollback
          if (get().currentConversationId) {
            get().fetchMessages(get().currentConversationId!);
          }
          toast.error(translateConversation('toasts.messages.feedbackError'));
        }
      },

      regenerateMessage: async (conversationId, messageId) => {
        // Find the questionMessageId from the AI message being regenerated
        const state = get();
        const found = state.messages.find((m) => m.id === messageId);
        const questionMsgId = found?.questionMessageId || null;

        set({
          isAwaitingFirstChunk: true,
          awaitingConversationId: conversationId,
          streamingQuestionMessageId: questionMsgId,
        });
        try {
          await api.regenerateMessage(conversationId, messageId);
          // Streaming will handle the new response via SSE
        } catch (err) {
          const apiError = parseApiError(err);
          set({
            isAwaitingFirstChunk: false,
            awaitingConversationId: null,
            streamingQuestionMessageId: null,
          });

          // Handle MODEL_INACTIVE error - refresh models and clear selection
          if (apiError.code === ErrorCode.MODEL_INACTIVE) {
            toast.error(translateConversation('toasts.model.unavailableTitle'), {
              description: translateConversation('toasts.model.unavailableDescription'),
            });
            useModelsStore.getState().refreshModels();
            set({ selectedModelId: null, selectedReasoningEffort: null });
          } else {
            toast.error(translateConversation('toasts.messages.regenerateError'), { description: apiError.message });
          }
        }
      },

      reportMessage: async (conversationId, messageId, payload) => {
        try {
          await api.reportMessage(conversationId, messageId, payload);
          toast.success(translateConversation('toasts.report.success'));
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ERR_1414') {
            toast.error(translateConversation('toasts.report.alreadySubmitted'));
          } else {
            toast.error(translateConversation('toasts.report.error'));
          }
          throw err;
        }
      },

      setReplyingToMessage: (message) => {
        set({ replyingToMessage: message });
      },

      clearReplyingTo: () => {
        set({ replyingToMessage: null });
      },

      // ===== Branch Actions =====

      fetchBranches: async (conversationId, userMessageId, selectLatest = false) => {
        try {
          const branches = await api.fetchBranches(conversationId, userMessageId);
          set((s) => {
            const newCache = new Map(s.branchCache);
            newCache.set(userMessageId, branches);
            const newActive = new Map(s.activeBranches);
            // Select latest if forced or if no branch selected yet
            if ((selectLatest || !newActive.has(userMessageId)) && branches.length > 0) {
              newActive.set(userMessageId, branches[branches.length - 1].id);
            }
            return { branchCache: newCache, activeBranches: newActive };
          });
        } catch (err) {
          console.error('[ConversationStore] fetchBranches error:', err);
        }
      },

      setActiveBranch: (userMessageId, aiMessageId) => {
        set((s) => {
          const newActive = new Map(s.activeBranches);
          newActive.set(userMessageId, aiMessageId);
          return { activeBranches: newActive };
        });
      },

      navigateBranch: (userMessageId, direction) => {
        const state = get();
        const branches = state.branchCache.get(userMessageId);
        if (!branches || branches.length <= 1) return;

        const currentId = state.activeBranches.get(userMessageId);
        const currentIndex = branches.findIndex((b) => b.id === currentId);
        const newIndex = direction === 'next' ? Math.min(currentIndex + 1, branches.length - 1) : Math.max(currentIndex - 1, 0);

        if (newIndex !== currentIndex) {
          get().setActiveBranch(userMessageId, branches[newIndex].id);
        }
      },

      setEditingMessage: (messageId) => {
        set({ editingMessageId: messageId });
      },

      updateUserMessage: async (conversationId, messageId, content, agentIds?, memberIds?) => {
        try {
          const updated = await api.updateMessage(conversationId, messageId, content, agentIds, memberIds);
          // Update message in cache (caller manages editingMessageId)
          set((s) => ({
            messages: s.messages.map((m) => (m.id === messageId ? { ...m, ...updated } : m)),
          }));
        } catch (err) {
          toast.error(translateConversation('toasts.messages.updateError'));
          throw err;
        }
      },

      // ===== Stream Actions =====

      stopStream: async () => {
        const { streamingConversationId, streamingMessageId } = get();
        if (!streamingConversationId || !streamingMessageId) return;
        try {
          await api.stopStream(streamingConversationId, streamingMessageId);
        } catch (err) {
          console.error('[ConversationStore] stopStream error:', err);
        }
      },

      onStreamStart: (event) => {
        cancelPendingStreamReconciliation();
        const state = get();
        const eventStreamKey = `${event.conversationId}:${event.messageId}`;

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — track in cache
          const newCache = new Map(state.streamingStateCache);
          const existing = newCache.get(event.conversationId);
          newCache.set(event.conversationId, {
            streamingMessageId: event.messageId,
            streamingQuestionMessageId: existing?.streamingQuestionMessageId ?? null,
            streamingComponents: [],
            isAwaitingFirstChunk: false,
          });
          set({
            streamingStateCache: newCache,
            ...(state.awaitingConversationId === event.conversationId
              ? {
                  isAwaitingFirstChunk: false,
                  awaitingConversationId: null,
                  pendingAssistantMessageId: event.messageId,
                }
              : {}),
          });
          return;
        }

        // Current conversation — clear any pending chunks from previous stream
        currentRevisionStreamKey = `${event.conversationId}:${event.messageId}`;
        currentStreamRevision = 0;
        receivedCurrentStreamStart = true;
        pendingRecoveryChunks = [];
        streamingBuffer.clear();

        // Set up the flush callback to batch-apply chunks
        streamingBuffer.setFlushCallback((chunks) => {
          set((s) => {
            const components = applyChunksToComponents(s.streamingComponents, chunks);
            const nextState: Partial<ConversationState> = {
              streamingComponents: components,
            };
            if (components.length > 0 && s.isAwaitingFirstChunk) {
              nextState.isAwaitingFirstChunk = false; // hide loader once chunks are renderable
              nextState.awaitingConversationId = null;
            }
            return nextState;
          });
        });

        set({
          isStreaming: true,
          streamingConversationId: event.conversationId,
          streamingMessageId: event.messageId,
          pendingAssistantMessageId: event.messageId,
          ...(state.pendingTerminalErrorKey !== eventStreamKey ? { pendingTerminalErrorKey: null } : {}),
          streamingComponents: [],
          inputDisabled: false,
          pendingLatencyPaint: null,
        });
        latencyPaint.clear();
      },

      onStreamChunk: (event) => {
        const state = get();

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — apply directly to cache (no throttle needed since not rendering)
          const cached = state.streamingStateCache.get(event.conversationId);
          if (cached) {
            const updated = applyChunksToComponents(cached.streamingComponents, [{ action: event.action, component: event.component }]);
            const newCache = new Map(state.streamingStateCache);
            newCache.set(event.conversationId, {
              ...cached,
              streamingComponents: updated,
              isAwaitingFirstChunk: updated.length > 0 ? false : cached.isAwaitingFirstChunk,
            });
            set({ streamingStateCache: newCache });
          }
          return;
        }

        // Latency instrumentation: the first model-derived chunk carries the
        // one-time envelope; record its browser arrival for the paint metric.
        // The client-metrics generation is stashed alongside: mid-stream it is
        // stable, and the completion report later uses it to tell "this turn's
        // window" apart from a newer send's window.
        if (event.latency) {
          clientMetricsTurnGeneration = clientMetricsGeneration;
          const captured = latencyPaint.capture({
            conversationId: event.conversationId,
            firstChunkReceivedPerfMs: performance.now(),
            latency: event.latency,
          });
          if (captured) set({ pendingLatencyPaint: captured });
        }

        // A forced resync is fetching the authoritative snapshot: hold deltas
        // of the affected conversation so they can be ordered against it
        // instead of rendering onto the state with the proven gap.
        if (resyncHoldActive && state.currentConversationId === resyncHoldConversationId) {
          if (resyncHeldChunks.length >= MAX_RESYNC_HELD_CHUNKS) {
            resyncHeldChunks = []; // the snapshot supersedes the held span
          } else {
            resyncHeldChunks.push({
              action: event.action,
              component: event.component,
              revision: event.revision,
            });
          }
          return;
        }

        if (event.revision !== undefined) {
          const messageId = event.messageId ?? state.streamingMessageId ?? '';
          const streamKey = `${event.conversationId}:${messageId}`;
          if (currentRevisionStreamKey !== streamKey) {
            currentRevisionStreamKey = streamKey;
            currentStreamRevision = 0;
            receivedCurrentStreamStart = false;
          }
          if (event.revision <= currentStreamRevision) return;
          currentStreamRevision = event.revision;
        }

        if (!state.isStreaming || state.streamingConversationId !== event.conversationId) {
          const placeholder = state.messages.find((message) => message.conversationType === 'ai' && message.isStreaming === true && message.isComplete !== true);
          set({
            isStreaming: true,
            streamingConversationId: event.conversationId,
            streamingMessageId: placeholder?.id ?? null,
            pendingAssistantMessageId: placeholder?.id ?? null,
          });
        }

        if (event.revision !== undefined && !receivedCurrentStreamStart) {
          // Revisioned content without an observed `stream_start` (cold send
          // raced the SSE pipe): keep a bounded backlog and recover from the
          // active-stream snapshot instead of waiting for completion.
          if (pendingRecoveryChunks.length >= MAX_PENDING_RECOVERY_CHUNKS) {
            pendingRecoveryChunks = []; // the snapshot supersedes the backlog
          } else {
            pendingRecoveryChunks.push({
              action: event.action,
              component: event.component,
              revision: event.revision,
            });
          }
          void recoverMissingStreamStart(event.conversationId);
          return;
        }

        // Immediate components (agent/tool/artifact activity) ride the same
        // frame queue as text: relative order with content is preserved and
        // the whole batch lands in one store commit per frame.
        streamingBuffer.addChunk(event.action, event.component, event.revision);
      },

      /**
       * Compute the sixth latency metric after React commit + double rAF.
       * Called from the paint observer in ConversationContent; one-shot per
       * stream and a no-op in hidden tabs (browsers throttle rAF there).
       */
      recordLatencyFirstPaint: () => {
        const before = get().pendingLatencyPaint;
        if (!before || before.measured) return;
        const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
        const updated = latencyPaint.measure(performance.now(), performance.timeOrigin, visible);
        if (!updated || updated === before) return;
        set({ pendingLatencyPaint: updated });
        // Completion may already have raced: attach to the persisted message now.
        set((s) => ({
          messages: s.messages.map((message) => (message.id === before.messageId ? withPendingLatency(message) : message)),
        }));
        // Completion arrived before the paint callback fired — report now.
        if (updated.completeArrived) {
          get().reportPendingLatency(before.conversationId, before.messageId);
        }
      },

      /** Fire-and-forget persistence of the sixth metric; clears the pending state. */
      reportPendingLatency: (conversationId: string, messageId: string) => {
        const payload = latencyPaint.report(conversationId, messageId);
        if (get().pendingLatencyPaint !== latencyPaint.pending) {
          set({ pendingLatencyPaint: latencyPaint.pending });
        }
        if (!payload) return;
        // The completed message's code highlight runs in a post-completion
        // effect, after this point — give it a short window to land in the
        // counters before snapshotting. Paint values come from captured
        // samples, so the delay does not shift any timing. The deferred
        // snapshot is keyed to the turn's generation (captured mid-stream with
        // the envelope, stable across the completion boundary): if a newer
        // send has opened its own window by fire time, this report drops its
        // counters instead of erasing the new turn's.
        const turnGeneration = clientMetricsTurnGeneration;
        setTimeout(() => {
          if (turnGeneration !== clientMetricsGeneration) return;
          const clientMetrics = streamMetrics.snapshotAndReset();
          api.reportFrontendLatency(conversationId, messageId, clientMetrics ? { ...payload, clientMetrics } : payload).catch((err) => console.error('[ConversationStore] frontend latency report failed:', err));
        }, CLIENT_METRICS_HIGHLIGHT_GRACE_MS);
      },

      onStreamComplete: async (event) => {
        const eventStreamKey = `${event.conversationId}:${event.messageId}`;
        if (pendingStreamReconcileTarget === eventStreamKey) cancelPendingStreamReconciliation();
        if (currentRevisionStreamKey === `${event.conversationId}:${event.messageId}`) {
          currentRevisionStreamKey = null;
          currentStreamRevision = 0;
          receivedCurrentStreamStart = false;
          pendingRecoveryChunks = [];
        }
        // Persist the browser-measured sixth metric after completion so the
        // request never competes with the first-token window.
        get().reportPendingLatency(event.conversationId, event.messageId);
        const state = get();

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — clean cache, message is now persisted in DB
          const newCache = new Map(get().streamingStateCache);
          if (newCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
            newCache.delete(event.conversationId);
          }
          const clearCompletedStream = state.streamingMessageId === event.messageId || state.pendingAssistantMessageId === event.messageId;
          set({
            streamingStateCache: newCache,
            ...(clearCompletedStream
              ? {
                  isStreaming: false,
                  streamingConversationId: null,
                  streamingMessageId: null,
                  streamingQuestionMessageId: null,
                  streamingComponents: [],
                  isAwaitingFirstChunk: false,
                  awaitingConversationId: null,
                  pendingAssistantMessageId: null,
                }
              : {}),
          });

          try {
            const message = await api.fetchMessage(event.conversationId, event.messageId);
            if (get().currentConversationId === event.conversationId) {
              set((s) => {
                const result = upsertMessage(s.messages, message);
                return {
                  messages: result.messages,
                  messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
                };
              });
            }
          } catch (err) {
            console.error('[ConversationStore] background completion reconciliation error:', err);
          }
          // Refresh conversations list to update sidebar order
          get().fetchConversations({ reset: true });
          return;
        }

        const completesActiveStream = state.streamingMessageId === event.messageId || state.pendingAssistantMessageId === event.messageId;
        if (completesActiveStream) {
          streamingBuffer.flush();
          streamingBuffer.clear();
        }

        // completeAIMessage broadcasts the canonical message before stream_complete.
        // Prefer that ordered SSE update; REST is only recovery for a missed update.
        const completedMessage = get().messages.find((message) => message.id === event.messageId && message.isComplete);
        if (completedMessage) {
          if (completesActiveStream) {
            const cleanedCache = new Map(get().streamingStateCache);
            if (cleanedCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
              cleanedCache.delete(event.conversationId);
            }
            set({
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: null,
              streamingStateCache: cleanedCache,
            });
          }

          if (completedMessage.questionMessageId) {
            get().fetchBranches(event.conversationId, completedMessage.questionMessageId, true);
          }
          get().fetchConversations({ reset: true });
          return;
        }

        // Recover the persisted message if its ordered SSE update was missed.
        try {
          const message = await api.fetchMessage(event.conversationId, event.messageId);
          let resolvedMessage = message;

          set((s) => {
            resolvedMessage = s.messages.find((candidate) => candidate.id === event.messageId && candidate.isComplete) ?? message;
            const result = upsertMessage(s.messages, resolvedMessage);
            const ownsCompletedStream = s.streamingMessageId === event.messageId || s.pendingAssistantMessageId === event.messageId;

            // Clean stale cache entry to prevent fetchMessages from restoring it
            const cleanedCache = new Map(s.streamingStateCache);
            if (cleanedCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
              cleanedCache.delete(event.conversationId);
            }

            return {
              messages: result.messages,
              messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
              streamingStateCache: cleanedCache,
              ...(ownsCompletedStream
                ? {
                    isStreaming: false,
                    streamingConversationId: null,
                    streamingMessageId: null,
                    streamingQuestionMessageId: null,
                    streamingComponents: [],
                    isAwaitingFirstChunk: false,
                    awaitingConversationId: null,
                    pendingAssistantMessageId: null,
                  }
                : {}),
            };
          });

          // Refresh branches if this AI message has a questionMessageId — select latest
          if (resolvedMessage.questionMessageId) {
            get().fetchBranches(event.conversationId, resolvedMessage.questionMessageId, true);
          }

          // Refresh conversations list to update sidebar order (reset to get fresh order)
          get().fetchConversations({ reset: true });
        } catch (err) {
          console.error('[ConversationStore] onStreamComplete fetch error:', err);
          // Still clear streaming state and stale cache entry
          const current = get();
          const ownsCompletedStream = current.streamingMessageId === event.messageId || current.pendingAssistantMessageId === event.messageId;
          if (ownsCompletedStream) {
            const cleanedCache = new Map(current.streamingStateCache);
            if (cleanedCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
              cleanedCache.delete(event.conversationId);
            }
            set({
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: null,
              streamingStateCache: cleanedCache,
            });
          }
        }
      },

      onStreamError: (event) => {
        const state = get();
        const eventStreamKey = `${event.conversationId}:${event.messageId}`;
        // A failed stream keeps at most partial latency data — drop the
        // browser paint state rather than reporting a misleading value.
        if (state.pendingLatencyPaint?.messageId === event.messageId) {
          latencyPaint.clear();
          set({ pendingLatencyPaint: null });
        }
        const cachedStream = state.streamingStateCache.get(event.conversationId);
        const ownsForegroundStream = state.streamingMessageId === event.messageId || state.pendingAssistantMessageId === event.messageId;
        const ownsCachedStream = cachedStream?.streamingMessageId === event.messageId;
        const foregroundMessageId = state.streamingMessageId ?? state.pendingAssistantMessageId;
        const ownsCompletedError = state.pendingTerminalErrorKey === eventStreamKey && (!foregroundMessageId || foregroundMessageId === event.messageId);
        if (!ownsForegroundStream && !ownsCachedStream && !ownsCompletedError) {
          if (state.inFlightSendConversations.has(event.conversationId) && !foregroundMessageId) {
            const earlyStreamErrors = new Map(state.earlyStreamErrors);
            earlyStreamErrors.set(event.conversationId, event);
            set({ earlyStreamErrors });
          }
          return;
        }

        if (pendingStreamReconcileTarget === `${event.conversationId}:${event.messageId}`) {
          cancelPendingStreamReconciliation();
        }
        if (currentRevisionStreamKey === `${event.conversationId}:${event.messageId}`) {
          currentRevisionStreamKey = null;
          currentStreamRevision = 0;
          receivedCurrentStreamStart = false;
          pendingRecoveryChunks = [];
        }

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — clean cache
          const newCache = new Map(get().streamingStateCache);
          if (newCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
            newCache.delete(event.conversationId);
          }
          set({
            streamingStateCache: newCache,
            ...(state.pendingTerminalErrorKey === eventStreamKey ? { pendingTerminalErrorKey: null } : {}),
            ...(ownsForegroundStream
              ? {
                  isStreaming: false,
                  streamingConversationId: null,
                  streamingMessageId: null,
                  streamingQuestionMessageId: null,
                  streamingComponents: [],
                  isAwaitingFirstChunk: false,
                  awaitingConversationId: null,
                  pendingAssistantMessageId: null,
                }
              : {}),
          });
          return;
        }

        // Clear any buffered chunks
        streamingBuffer.clear();

        const errorInfo = getStreamErrorMessage(event.errorCode);

        // Clean stale cache entry to prevent fetchMessages from restoring it
        const cleanedCache = new Map(get().streamingStateCache);
        if (cleanedCache.get(event.conversationId)?.streamingMessageId === event.messageId) {
          cleanedCache.delete(event.conversationId);
        }

        if (errorInfo.isCritical) {
          set({
            criticalError: {
              code: event.errorCode,
              message: errorInfo.description,
            },
            inputDisabled: true,
            isStreaming: false,
            streamingConversationId: null,
            streamingMessageId: null,
            streamingQuestionMessageId: null,
            streamingComponents: [],
            isAwaitingFirstChunk: false,
            awaitingConversationId: null,
            pendingAssistantMessageId: null,
            pendingTerminalErrorKey: null,
            streamingStateCache: cleanedCache,
          });
        } else {
          toast.error(errorInfo.title, { description: errorInfo.description });
          set({
            isStreaming: false,
            streamingConversationId: null,
            streamingMessageId: null,
            streamingQuestionMessageId: null,
            streamingComponents: [],
            isAwaitingFirstChunk: false,
            awaitingConversationId: null,
            pendingAssistantMessageId: null,
            pendingTerminalErrorKey: null,
            streamingStateCache: cleanedCache,
          });
        }
      },

      onConversationNameGenerated: (event) => {
        set((s) => {
          // Update current conversation if it matches
          const updatedCurrent = s.currentConversation?.id === event.conversationId ? { ...s.currentConversation, title: event.name } : s.currentConversation;

          // Update in flat conversations array
          const updatedConversations = s.conversations.map((c) => (c.id === event.conversationId ? { ...c, title: event.name } : c));

          return {
            currentConversation: updatedCurrent,
            conversations: updatedConversations,
            // Trigger typewriter effect
            typewriterConversationId: event.conversationId,
            typewriterName: event.name,
          };
        });
      },

      onMessageCreated: (event) => {
        const state = get();
        if (event.conversationId !== state.currentConversationId) {
          // Update conversations list in background to show last message timestamp/activity
          get().fetchConversations({ reset: true });
          return;
        }

        // Check if message already exists (e.g. sender's own optimistic update or fetchMessages race)
        const alreadyExists = state.messages.some((m) => m.id === event.message.id);
        if (alreadyExists) return;

        set((s) => {
          // Optimistic ids are temp-*; clear the matching pending user turn (content + conversation).
          let clearedOptimistic = false;
          const optimisticMessages = s.optimisticMessages.filter((m) => {
            if (m.id === event.message.id) return false;
            if (!clearedOptimistic && m.id.startsWith('temp-') && m.conversationType === 'user' && event.message.conversationType === 'user' && m.conversationId === event.conversationId && m.content === event.message.content) {
              clearedOptimistic = true;
              return false;
            }
            return true;
          });

          return {
            // Chronological insert: this SSE event may arrive before the POST
            // response that created the triggering user message (see
            // insertMessageChronologically — appending would render the prompt
            // after its answer).
            messages: insertMessageChronologically(s.messages, event.message),
            messagesTotal: s.messagesTotal + 1,
            optimisticMessages,
          };
        });

        // Refresh conversations list to update sidebar order
        get().fetchConversations({ reset: true });
      },

      onMessageUpdated: (event) => {
        const state = get();
        if (event.conversationId !== state.currentConversationId) return;

        const completesPendingStream = event.message.isComplete === true && (state.streamingMessageId === event.messageId || state.pendingAssistantMessageId === event.messageId);
        const completesWithError = completesPendingStream && hasErrorComponent(event.message);
        if (completesPendingStream) {
          cancelPendingStreamReconciliation();
          streamingBuffer.flush();
          streamingBuffer.clear();
        }

        const existing = state.messages.find((message) => message.id === event.messageId);
        if (existing) {
          set((s) => {
            const cache = new Map(s.streamingStateCache);
            if (completesPendingStream) cache.delete(event.conversationId);
            return {
              messages: s.messages.map((message) =>
                message.id === event.messageId
                  ? withPendingLatency({
                      ...message,
                      ...event.message,
                      ...(event.message.components ? { components: event.message.components } : {}),
                      reliabilityEvaluation: event.message.reliabilityEvaluation ?? message.reliabilityEvaluation,
                      correctionWorkflow: event.message.correctionWorkflow ?? message.correctionWorkflow,
                    })
                  : message,
              ),
              ...(event.message.conversationUsage ? { conversationUsage: event.message.conversationUsage } : {}),
              ...(completesPendingStream
                ? {
                    isStreaming: false,
                    streamingConversationId: null,
                    streamingMessageId: null,
                    streamingQuestionMessageId: null,
                    streamingComponents: [],
                    isAwaitingFirstChunk: false,
                    awaitingConversationId: null,
                    pendingAssistantMessageId: null,
                    pendingTerminalErrorKey: completesWithError ? `${event.conversationId}:${event.messageId}` : null,
                    streamingStateCache: cache,
                  }
                : {}),
            };
          });
          return;
        }

        if (event.message.conversationType && event.message.createdAt) {
          set((s) => {
            const message = withPendingLatency({
              ...event.message,
              ...(event.message.components ? { components: event.message.components } : {}),
              id: event.messageId,
              conversationId: event.conversationId,
            } as Message);
            const result = upsertMessage(s.messages, message);
            const cache = new Map(s.streamingStateCache);
            if (completesPendingStream) cache.delete(event.conversationId);
            return {
              messages: result.messages,
              messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
              ...(completesPendingStream
                ? {
                    isStreaming: false,
                    streamingConversationId: null,
                    streamingMessageId: null,
                    streamingQuestionMessageId: null,
                    streamingComponents: [],
                    isAwaitingFirstChunk: false,
                    awaitingConversationId: null,
                    pendingAssistantMessageId: null,
                    pendingTerminalErrorKey: completesWithError ? `${event.conversationId}:${event.messageId}` : null,
                    streamingStateCache: cache,
                  }
                : {}),
            };
          });
          return;
        }

        void api
          .fetchMessage(event.conversationId, event.messageId)
          .then((message) => {
            if (get().currentConversationId !== event.conversationId) return;
            set((s) => {
              // The partial SSE update may arrive before the fetch it triggers. It is newer
              // than a response produced just before correction metadata was persisted.
              const reconciled = {
                ...message,
                ...event.message,
                id: event.messageId,
                conversationId: event.conversationId,
              } as Message;
              const result = upsertMessage(s.messages, reconciled);
              return {
                messages: result.messages,
                messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
              };
            });
          })
          .catch((err) => console.error('[ConversationStore] message update reconciliation error:', err));
      },

      reconcilePendingStream: async () => {
        const state = get();
        const conversationId = state.streamingConversationId ?? state.awaitingConversationId;
        const messageId = state.streamingMessageId ?? state.pendingAssistantMessageId;
        if (!conversationId || !messageId) return;
        const target = `${conversationId}:${messageId}`;
        if (pendingStreamReconcileTarget !== target) {
          cancelPendingStreamReconciliation();
          pendingStreamReconcileTarget = target;
        }
        if (pendingStreamReconcileInFlight || pendingStreamReconcileAttempts >= MAX_PENDING_STREAM_RECONCILE_ATTEMPTS) return;
        pendingStreamReconcileInFlight = true;
        pendingStreamReconcileAttempts += 1;

        try {
          const message = await api.fetchMessage(conversationId, messageId);
          const current = get();
          const currentMessageId = current.streamingMessageId ?? current.pendingAssistantMessageId;
          if (current.currentConversationId !== conversationId || currentMessageId !== messageId) return;
          if (!message.isComplete) {
            schedulePendingStreamReconciliation(() => get().reconcilePendingStream());
            return;
          }

          cancelPendingStreamReconciliation();
          streamingBuffer.flush();
          streamingBuffer.clear();
          set((s) => {
            const result = upsertMessage(s.messages, message);
            const cache = new Map(s.streamingStateCache);
            cache.delete(conversationId);
            return {
              messages: result.messages,
              messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: null,
              pendingTerminalErrorKey: hasErrorComponent(message) ? target : null,
              streamingStateCache: cache,
            };
          });
        } catch (err) {
          console.error('[ConversationStore] pending stream reconciliation error:', err);
          const current = get();
          if (current.currentConversationId === conversationId && (current.streamingMessageId ?? current.pendingAssistantMessageId) === messageId) {
            if (isTransientReconciliationError(err)) {
              schedulePendingStreamReconciliation(() => get().reconcilePendingStream());
            }
          }
        } finally {
          if (pendingStreamReconcileTarget === target) pendingStreamReconcileInFlight = false;
        }
      },

      /**
       * The server could not replay a missed event window (cursor gap or
       * process switch), so SSE history is no longer contiguous. For the
       * live run this forces installation of the authoritative active-stream
       * snapshot (held deltas apply only when newer than it); without a
       * tracked run it falls back to the canonical message reload.
       */
      onStreamResyncRequired: (event) => {
        console.warn('[ConversationStore] stream resync required', {
          reason: event.reason,
        });
        const conversationId = get().currentConversationId;
        if (!conversationId) return;
        void forcedResyncActiveStream(conversationId);
      },

      onMentionCreated: (event) => {
        set((s) => {
          // Update in flat conversations array to show count in sidebar
          const updatedConversations = s.conversations.map((c) => {
            if (c.id !== event.conversationId) return c;
            if (!c.groupMeta) return c;

            const updatedMembers = c.groupMeta.members.map((m) => {
              if (m.userId !== event.userId) return m;
              const mentions = m.mentions || [];
              if (mentions.some((mn) => mn.messageId === event.messageId)) return m;

              return {
                ...m,
                mentions: [...mentions, { messageId: event.messageId }],
              };
            });

            return {
              ...c,
              groupMeta: {
                ...c.groupMeta,
                members: updatedMembers,
              },
            };
          });

          // Update current conversation if it matches
          let updatedCurrent = s.currentConversation;
          if (s.currentConversation?.id === event.conversationId && s.currentConversation.groupMeta) {
            const updatedMembers = s.currentConversation.groupMeta.members.map((m) => {
              if (m.userId !== event.userId) return m;
              const mentions = m.mentions || [];
              if (mentions.some((mn) => mn.messageId === event.messageId)) return m;

              return {
                ...m,
                mentions: [...mentions, { messageId: event.messageId }],
              };
            });
            updatedCurrent = {
              ...s.currentConversation,
              groupMeta: {
                ...s.currentConversation.groupMeta,
                members: updatedMembers,
              },
            };
          }

          return {
            conversations: updatedConversations,
            currentConversation: updatedCurrent,
          };
        });
      },

      markMentionSeen: async (conversationId, messageId) => {
        try {
          await api.markMentionSeen(conversationId, messageId);

          set((s) => {
            // Update current conversation
            let updatedCurrent = s.currentConversation;
            if (s.currentConversation?.id === conversationId && s.currentConversation.groupMeta) {
              const updatedMembers = s.currentConversation.groupMeta.members.map((m) => {
                const updatedMentions = m.mentions?.map((mn) => (mn.messageId === messageId ? { ...mn, seenAt: new Date().toISOString() } : mn));
                return { ...m, mentions: updatedMentions };
              });
              updatedCurrent = {
                ...s.currentConversation,
                groupMeta: {
                  ...s.currentConversation.groupMeta,
                  members: updatedMembers,
                },
              };
            }

            // Update conversations list
            const updatedConversations = s.conversations.map((c) => {
              if (c.id !== conversationId || !c.groupMeta) return c;
              const updatedMembers = c.groupMeta.members.map((m) => {
                const updatedMentions = m.mentions?.map((mn) => (mn.messageId === messageId ? { ...mn, seenAt: new Date().toISOString() } : mn));
                return { ...m, mentions: updatedMentions };
              });
              return {
                ...c,
                groupMeta: { ...c.groupMeta, members: updatedMembers },
              };
            });

            return {
              currentConversation: updatedCurrent,
              conversations: updatedConversations,
            };
          });
        } catch (err) {
          console.error('[ConversationStore] markMentionSeen error:', err);
        }
      },
      setMentionNavigationLock: (locked) => {
        set({ mentionNavigationLock: locked });
      },

      clearTypewriter: () => {
        set({ typewriterConversationId: null, typewriterName: null });
      },

      // ===== SSE Connection Actions =====

      onSSEConnected: () => {
        set({ sseStatus: 'connected', sseError: null });
        void get().reconcilePendingStream();
      },

      onConnectionFailed: (reason) => {
        set({ sseStatus: 'failed', sseError: reason, inputDisabled: true });
      },

      dismissSSEError: () => {
        set({ sseError: null, inputDisabled: false });
      },

      // ===== Error Actions =====

      dismissCriticalError: () => {
        set({ criticalError: null, inputDisabled: false });
      },

      retryLastMessage: async () => {
        const state = get();
        if (!state.currentConversationId) return;

        // Find the last AI message that failed
        const lastAiMsg = [...state.messages].reverse().find((m) => m.conversationType === 'ai');

        if (lastAiMsg) {
          set({ criticalError: null, inputDisabled: false });
          await get().regenerateMessage(state.currentConversationId, lastAiMsg.id);
        }
      },

      // ===== Model Selection =====

      setSelectedModelId: (modelId) => {
        const model = modelId ? useModelsStore.getState().models.find((candidate) => candidate.id === modelId) : undefined;
        set({
          selectedModelId: modelId,
          selectedReasoningEffort: model?.reasoning?.defaultEffort ?? null,
        });
      },

      setSelectedReasoningEffort: (effort) => {
        set({ selectedReasoningEffort: effort });
      },

      // ===== Workspace Selection =====

      setSelectedWorkspaceIds: (workspaceIds) => {
        set({
          selectedWorkspaceIds: workspaceIds,
          ...(workspaceIds.length ? { selectedSemanticModelId: null } : {}),
        });
      },

      resetSelectedWorkspaceIds: () => {
        set({ selectedWorkspaceIds: [] });
      },

      setSelectedSemanticModelId: (modelId) => {
        set({ selectedSemanticModelId: modelId });
      },

      setSelectedConnectorRepo: (repo) => {
        set({ selectedConnectorRepo: repo });
      },

      setDeepSearchEnabled: (enabled) => {
        set({ deepSearchEnabled: enabled });
      },

      setWebConnectorAccessEnabled: (enabled) => {
        set({ webConnectorAccessEnabled: enabled });
      },

      setSelectedSkillIds: (skillIds) => {
        set({ selectedSkillIds: skillIds });
        get().persistSelectedSkills();
      },

      toggleSelectedSkill: (skillId) => {
        set((s) => ({
          selectedSkillIds: s.selectedSkillIds.includes(skillId) ? s.selectedSkillIds.filter((id) => id !== skillId) : [...s.selectedSkillIds, skillId],
        }));
        get().persistSelectedSkills();
      },

      clearSelectedSkills: () => {
        set({ selectedSkillIds: [] });
        get().persistSelectedSkills();
      },

      // Persist the current skill selection onto the active conversation so it
      // survives refreshes. No-op when there is no conversation yet (new chat) —
      // the selection is then persisted on send.
      persistSelectedSkills: () => {
        const { currentConversationId, selectedSkillIds } = get();
        if (!currentConversationId) return;
        api
          .updateConversation(currentConversationId, {
            skillIds: selectedSkillIds,
          })
          .catch((err) => console.error('[ConversationStore] persistSelectedSkills error:', err));
      },

      // ===== Cleanup =====

      clearMessages: () => {
        const state = get();
        const convId = state.streamingConversationId || state.awaitingConversationId || state.currentConversationId;

        // Save streaming/awaiting state to cache before clearing
        if (convId && (state.isStreaming || state.isAwaitingFirstChunk)) {
          // Flush remaining buffered chunks so cache has complete state
          streamingBuffer.flush();
          const stateAfterFlush = get();
          const newCache = new Map(stateAfterFlush.streamingStateCache);
          newCache.set(convId, {
            streamingMessageId: stateAfterFlush.streamingMessageId || '',
            streamingQuestionMessageId: stateAfterFlush.streamingQuestionMessageId,
            streamingComponents: [...stateAfterFlush.streamingComponents],
            isAwaitingFirstChunk: stateAfterFlush.isAwaitingFirstChunk,
          });
          set({ streamingStateCache: newCache });
        }

        streamingBuffer.clear();
        set({
          messages: [],
          messagesTotal: 0,
          conversationUsage: null,
          messagesLoading: false,
          messagesLoadingOlder: false,
          messagesHasMore: false,
          isStreaming: false,
          streamingConversationId: null,
          streamingMessageId: null,
          streamingQuestionMessageId: null,
          streamingComponents: [],
          isAwaitingFirstChunk: false,
          awaitingConversationId: null,
          pendingAssistantMessageId: null,
          pendingTerminalErrorKey: null,
          earlyStreamErrors: new Map(),
          inFlightSendConversations: new Set(),
          optimisticMessages: [],
          branchCache: new Map(),
          activeBranches: new Map(),
          editingMessageId: null,
          replyingToMessage: null,
          selectedModelId: null,
          selectedReasoningEffort: null,
        });
      },

      clearAll: () => {
        streamingBuffer.clear();
        latencyPaint.clear();
        set({
          conversations: [],
          conversationSummaries: [],
          conversationsTotal: 0,
          conversationsHasMore: false,
          conversationsLoading: false,
          projectConversations: {},
          projectConversationsLoading: {},
          // historyPanelOpen NOT cleared - persisted in localStorage
          currentConversationId: null,
          currentConversation: null,
          conversationLoading: false,
          messages: [],
          messagesTotal: 0,
          conversationUsage: null,
          messagesLoading: false,
          messagesLoadingOlder: false,
          messagesHasMore: false,
          isStreaming: false,
          streamingConversationId: null,
          streamingMessageId: null,
          streamingQuestionMessageId: null,
          streamingComponents: [],
          pendingLatencyPaint: null,
          isAwaitingFirstChunk: false,
          awaitingConversationId: null,
          pendingAssistantMessageId: null,
          pendingTerminalErrorKey: null,
          earlyStreamErrors: new Map(),
          inFlightSendConversations: new Set(),
          optimisticMessages: [],
          branchCache: new Map(),
          activeBranches: new Map(),
          editingMessageId: null,
          replyingToMessage: null,
          sseStatus: 'disconnected' as SSEConnectionStatus,
          sseError: null,
          criticalError: null,
          inputDisabled: false,
          selectedModelId: null,
          selectedReasoningEffort: null,
          streamingStateCache: new Map(),
          typewriterConversationId: null,
          typewriterName: null,
        });
      },

      // ===== History Panel Actions =====

      setHistoryPanelOpen: (open: boolean) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('historyPanelOpen', String(open));
        }
        set({ historyPanelOpen: open });
      },

      toggleHistoryPanel: () => {
        const newState = !get().historyPanelOpen;
        if (typeof window !== 'undefined') {
          localStorage.setItem('historyPanelOpen', String(newState));
        }
        set({ historyPanelOpen: newState });
      },
    }),
    { name: 'conversation-store' },
  ),
);

// ===== Selector Hooks =====

const EMPTY_CONVERSATIONS: Conversation[] = [];
const EMPTY_CONVERSATION_SUMMARIES: ConversationSummary[] = [];
const EMPTY_MESSAGES: Message[] = [];

export const useConversations = () => useConversationStore((s) => (s.conversationSummaries.length === 0 ? EMPTY_CONVERSATION_SUMMARIES : s.conversationSummaries));

export const useHistoryConversations = () =>
  useConversationStore(
    useShallow((s) => {
      const filtered = s.conversationSummaries.filter((c) => !c.projectId);
      return filtered.length === 0 ? EMPTY_CONVERSATION_SUMMARIES : filtered;
    }),
  );

export const useConversationsByProject = (projectId: string) =>
  useConversationStore(
    useShallow((s) => {
      const list = s.projectConversations[projectId];
      return !list || list.length === 0 ? EMPTY_CONVERSATIONS : list;
    }),
  );

export const useProjectConversationsLoading = (projectId: string) => useConversationStore((s) => !!s.projectConversationsLoading[projectId]);

// ===== Project list helpers =====

function mapProjectLists(lists: Record<string, Conversation[]>, fn: (c: Conversation) => Conversation): Record<string, Conversation[]> {
  const next: Record<string, Conversation[]> = {};
  for (const [pid, arr] of Object.entries(lists)) {
    next[pid] = arr.map(fn);
  }
  return next;
}

function filterProjectLists(lists: Record<string, Conversation[]>, pred: (c: Conversation) => boolean): Record<string, Conversation[]> {
  const next: Record<string, Conversation[]> = {};
  for (const [pid, arr] of Object.entries(lists)) {
    next[pid] = arr.filter(pred);
  }
  return next;
}

function rebalanceProjectLists(lists: Record<string, Conversation[]>, conversationId: string, fromProjectId: string | null, toProjectId: string | null, conv: Conversation | null): Record<string, Conversation[]> {
  const next: Record<string, Conversation[]> = { ...lists };

  // Remove from source list (if loaded)
  if (fromProjectId && next[fromProjectId]) {
    next[fromProjectId] = next[fromProjectId].filter((c) => c.id !== conversationId);
  }

  // Add to or update in target list (only if that project's list is loaded)
  if (toProjectId && conv) {
    const targetList = next[toProjectId];
    if (targetList) {
      const exists = targetList.some((c) => c.id === conversationId);
      next[toProjectId] = exists ? targetList.map((c) => (c.id === conversationId ? conv : c)) : [conv, ...targetList];
    }
  }

  return next;
}

export const useConversationsLoading = () => useConversationStore((s) => s.conversationsLoading);

export const useConversationsHasMore = () => useConversationStore((s) => s.conversationsHasMore);

export const useHistoryPanelOpen = () => useConversationStore((s) => s.historyPanelOpen);

export const useToggleHistoryPanel = () => useConversationStore((s) => s.toggleHistoryPanel);

export const useCurrentConversation = () => useConversationStore((s) => s.currentConversation);

export const useConversationLoading = () => useConversationStore((s) => s.conversationLoading);

export const useMessages = () => useConversationStore((s) => (s.messages.length === 0 ? EMPTY_MESSAGES : s.messages));

export const useMessagesLoadingOlder = () => useConversationStore((s) => s.messagesLoadingOlder);

export const useAllMessages = () =>
  useConversationStore(
    useShallow((s) => {
      // Combine messages with optimistic messages, dedupe by ID / temp content match
      if (s.optimisticMessages.length === 0) {
        return s.messages.length === 0 ? EMPTY_MESSAGES : s.messages;
      }

      const seenIds = new Set(s.messages.map((m) => m.id));
      const newOptimistic = s.optimisticMessages.filter((m) => {
        if (seenIds.has(m.id)) return false;
        if (m.id.startsWith('temp-') && m.conversationType === 'user') {
          return !s.messages.some((msg) => msg.conversationType === 'user' && msg.conversationId === m.conversationId && msg.content === m.content);
        }
        return true;
      });

      if (newOptimistic.length === 0) {
        return s.messages.length === 0 ? EMPTY_MESSAGES : s.messages;
      }

      return newOptimistic.reduce(insertMessageChronologically, s.messages);
    }),
  );

export const useIsAwaitingFirstChunk = () => useConversationStore((s) => s.isAwaitingFirstChunk);
export const useAwaitingConversationId = () => useConversationStore((s) => s.awaitingConversationId);

export const useCriticalError = () => useConversationStore((s) => s.criticalError);

export const useInputDisabled = () => useConversationStore((s) => s.inputDisabled || s.conversationLoading);

export const useMessagesHasMore = () => useConversationStore((s) => s.messagesHasMore);

export const useSSEError = () => useConversationStore((s) => s.sseError);

export const useSSEStatus = () => useConversationStore((s) => s.sseStatus);

export const useMessagesLoading = () => useConversationStore((s) => s.messagesLoading);

export const useIsInitialLoading = () => useConversationStore((s) => s.conversationLoading || s.messagesLoading);

export const useSelectedModelId = () => useConversationStore((s) => s.selectedModelId);

export const useSetSelectedModelId = () => useConversationStore((s) => s.setSelectedModelId);

export const useSelectedReasoningEffort = () => useConversationStore((s) => s.selectedReasoningEffort);

export const useSetSelectedReasoningEffort = () => useConversationStore((s) => s.setSelectedReasoningEffort);

export const useSelectedWorkspaceIds = () => useConversationStore((s) => s.selectedWorkspaceIds);

export const useSetSelectedWorkspaceIds = () => useConversationStore((s) => s.setSelectedWorkspaceIds);

export const useResetSelectedWorkspaceIds = () => useConversationStore((s) => s.resetSelectedWorkspaceIds);

export const useSelectedSemanticModelId = () => useConversationStore((s) => s.selectedSemanticModelId);

export const useSetSelectedSemanticModelId = () => useConversationStore((s) => s.setSelectedSemanticModelId);

export const useSelectedConnectorRepo = () => useConversationStore((s) => s.selectedConnectorRepo);

export const useSetSelectedConnectorRepo = () => useConversationStore((s) => s.setSelectedConnectorRepo);

export const useDeepSearchEnabled = () => useConversationStore((s) => s.deepSearchEnabled);

export const useSetDeepSearchEnabled = () => useConversationStore((s) => s.setDeepSearchEnabled);

export const useWebConnectorAccessEnabled = () => useConversationStore((s) => s.webConnectorAccessEnabled);

export const useSetWebConnectorAccessEnabled = () => useConversationStore((s) => s.setWebConnectorAccessEnabled);

export const useSelectedSkillIds = () => useConversationStore((s) => s.selectedSkillIds);

export const useToggleSelectedSkill = () => useConversationStore((s) => s.toggleSelectedSkill);

export const useSetSelectedSkillIds = () => useConversationStore((s) => s.setSelectedSkillIds);

export const useBranchCache = () => useConversationStore(useShallow((s) => s.branchCache));

export const useActiveBranches = () => useConversationStore(useShallow((s) => s.activeBranches));

export const useEditingMessageId = () => useConversationStore((s) => s.editingMessageId);

export const useReplyingToMessage = () => useConversationStore((s) => s.replyingToMessage);

/**
 * Returns messages filtered to only show the active branch AI message per user question.
 * Non-active AI siblings are hidden.
 */
export const useDisplayMessages = () =>
  useConversationStore(
    useShallow((s) => {
      // Combine messages with optimistic messages, dedupe by ID / temp content match
      let combined: Message[];
      if (s.optimisticMessages.length === 0) {
        combined = s.messages;
      } else {
        const seenIds = new Set(s.messages.map((m) => m.id));
        const newOptimistic = s.optimisticMessages.filter((m) => {
          if (seenIds.has(m.id)) return false;
          if (m.id.startsWith('temp-') && m.conversationType === 'user') {
            return !s.messages.some((msg) => msg.conversationType === 'user' && msg.conversationId === m.conversationId && msg.content === m.content);
          }
          return true;
        });
        combined = newOptimistic.length === 0 ? s.messages : newOptimistic.reduce(insertMessageChronologically, s.messages);
      }

      if (combined.length === 0) return EMPTY_MESSAGES;

      // Filter: for AI messages with a questionMessageId, only show the active branch
      // Also hide all AI siblings when streaming a new regeneration for that question
      return combined.filter((msg) => {
        if (msg.id === s.streamingMessageId) return false;
        if (msg.conversationType !== 'ai' || !msg.questionMessageId) return true;
        // Hide old AI answers while regenerating/streaming a new one for the same question
        if (s.streamingQuestionMessageId === msg.questionMessageId) return false;
        const branches = s.branchCache.get(msg.questionMessageId);
        if (!branches || branches.length <= 1) return true;
        const activeId = s.activeBranches.get(msg.questionMessageId);
        return msg.id === activeId;
      });
    }),
  );

// When the admin default model changes (e.g. star on /admin/models), drop a
// stale selection that matched the old default so consumers fall back to the
// new default immediately without a refresh. Mirrors conversation-v2's handling.
if (typeof window !== 'undefined') {
  window.addEventListener(DEFAULT_MODEL_CHANGED_EVENT, (event) => {
    const previousDefaultId = (event as CustomEvent<{ previousDefaultId?: string | null }>).detail
      ?.previousDefaultId;
    if (!previousDefaultId) return;
    const { selectedModelId, setSelectedModelId } = useConversationStore.getState();
    if (selectedModelId === previousDefaultId) {
      setSelectedModelId(null);
    }
  });
}
