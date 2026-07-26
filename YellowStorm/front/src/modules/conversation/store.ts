import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { useModelsStore } from '@/modules/models/store';
import * as api from './api';
import { getStreamErrorMessage } from './utils';
import { conversationStreamService } from './stream';
import { translateConversation } from './translation';
import type { Conversation, Message, StreamingComponent, SendMessagePayload, CreateReportPayload, StreamStartEvent, StreamChunkEvent, StreamCompleteEvent, StreamErrorEvent, ConversationNameGeneratedEvent, SSEConnectionStatus, MessageCreatedEvent, MessageUpdatedEvent } from './types';

export const DEFAULT_CONVERSATIONS_LIMIT = 12;
const DEFAULT_MESSAGES_LIMIT = 5;
let currentConversationRequestSequence = 0;

// ===== Streaming Helper Functions =====

/** Cached streaming state for conversations that are streaming in the background. */
interface CachedStreamingState {
  streamingMessageId: string;
  streamingQuestionMessageId: string | null;
  streamingComponents: StreamingComponent[];
  isAwaitingFirstChunk: boolean;
}

/**
 * Apply an array of chunk actions to a components array, returning a new array.
 * Used both by the buffer flush callback (current conversation) and by direct
 * cache updates (background conversations).
 */
export function applyChunksToComponents(
  components: StreamingComponent[],
  chunks: Array<{ action: 'add' | 'update' | 'delete'; component: StreamingComponent }>,
): StreamingComponent[] {
  let result = [...components];
  for (const { action, component } of chunks) {
    if (action === 'add') {
      if (component.type === 'chart') {
        console.debug('[applyChunksToComponents][add][chart]', {
          id: component.id,
          dataKeys: Object.keys(component.data),
          data: component.data,
        });
      }
      result.push({ ...component, data: initializeStreamingData(component.type, component.data) });
    } else if (action === 'update') {
      if (component.type === 'chart') {
        console.debug('[applyChunksToComponents][update][chart]', {
          id: component.id,
          incomingDataKeys: Object.keys(component.data),
        });
      }
      result = result.map((comp) => {
        if (comp.id !== component.id) return comp;
        return { ...comp, data: mergeStreamingData(comp.type, comp.data, component.data) };
      });
    } else if (action === 'delete') {
      result = result.filter((comp) => comp.id !== component.id);
    }
  }
  return result;
}

/**
 * Streaming chunk queue with throttled drain.
 * Chunks arrive fast from SSE but are applied ONE at a time at a controlled
 * pace, producing a smooth word-by-word typewriter effect.
 * If the queue grows too large the drain speed increases to prevent lag.
 */
class StreamingBuffer {
  private queue: Array<{ action: 'add' | 'update' | 'delete'; component: StreamingComponent }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: ((chunks: Array<{ action: 'add' | 'update' | 'delete'; component: StreamingComponent }>) => void) | null = null;
  private readonly BASE_INTERVAL_MS = 30; // Base ms between each chunk render

  setFlushCallback(callback: (chunks: Array<{ action: 'add' | 'update' | 'delete'; component: StreamingComponent }>) => void) {
    this.flushCallback = callback;
  }

  addChunk(action: 'add' | 'update' | 'delete', component: StreamingComponent) {
    this.queue.push({ action, component });

    // Safety cap: if queue grew too large (e.g. tab was backgrounded), flush everything
    if (this.queue.length > 500) {
      this.flush();
      return;
    }

    this.scheduleDrain();
  }

  /** Synchronously drain all remaining chunks (used on stream end). */
  flush() {
    this.cancelDrain();
    if (this.queue.length > 0 && this.flushCallback) {
      const chunks = this.queue.splice(0);
      this.flushCallback(chunks);
    }
  }

  clear() {
    this.queue = [];
    this.cancelDrain();
  }

  // --- internals ---

  private scheduleDrain() {
    if (this.drainTimer || this.queue.length === 0) return;
    this.drainTimer = setTimeout(() => this.drainOne(), this.getDrainInterval());
  }

  /** Adaptive interval: speed up when queue is building to avoid falling behind. */
  private getDrainInterval(): number {
    const len = this.queue.length;
    if (len > 20) return 5;
    if (len > 10) return 15;
    return this.BASE_INTERVAL_MS;
  }

  private drainOne() {
    this.drainTimer = null;
    if (this.queue.length === 0 || !this.flushCallback) return;

    // Batch-drain when queue is large to reduce React re-render count
    const batchSize = this.queue.length > 20 ? 5 : this.queue.length > 10 ? 3 : 1;
    const chunks = this.queue.splice(0, batchSize);
    this.flushCallback(chunks);

    // Continue draining if more queued
    this.scheduleDrain();
  }

  private cancelDrain() {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }
}

const streamingBuffer = new StreamingBuffer();

function upsertMessage(messages: Message[], message: Message): { messages: Message[]; inserted: boolean } {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return { messages: [...messages, message], inserted: true };

  const next = [...messages];
  next[index] = { ...next[index], ...message };
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
    }
    else {
      actualData = parseJsonArray(data.data) || parseJsonArray(data.chartData);
    }

    console.debug('[ConversationStream][chart][init]', {
      id: (data as { id?: string }).id,
      hasData: actualData.length > 0,
      dataKeys: Object.keys(data),
      actualDataLength: actualData.length,
      dataDataType: typeof data.data,
      chartDataDataType: typeof data.chartData,
    });

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
    case 'text':
    case 'reasoning': {
      if (incoming.guardrailDecision) {
        return { ...existing, ...incoming };
      }
      // Append content for streaming text types
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      return {
        ...existing,
        content: existingContent + newContent,
      };
    }
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
    case 'chainOfThought':
      // Charts and other structured components replace the full payload on update.
      return { ...incoming };
    case 'toolInfo':
      // Terminal tool updates only include status. Retain the arguments from
      // the initial event so the live debug pane matches persisted history.
      return {
        ...existing,
        ...incoming,
        title: (incoming.title as string) || (existing.title as string) || '',
        status: (incoming.status as string) || (existing.status as string) || 'running',
        params: (incoming.params as string) || (existing.params as string) || '',
        startedAt: (incoming.startedAt as string) || (existing.startedAt as string) || '',
        resultJson: (incoming.resultJson as string) || (existing.resultJson as string) || '',
      };
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
      const chartDataObj = typeof incoming.data === 'object' && incoming.data !== null
        ? { ...(typeof existing.data === 'object' && existing.data !== null ? existing.data as Record<string, unknown> : {}), ...(incoming.data as Record<string, unknown>) }
        : (typeof existing.data === 'object' && existing.data !== null ? existing.data as Record<string, unknown> : {});

      console.debug('[ConversationStream][chart][merge]', {
        id: (existing as { id?: string }).id,
        incomingHasChartData: Array.isArray(incomingChartData) ? incomingChartData.length : 0,
        existingHasChartData: Array.isArray(existingChartData) ? existingChartData.length : 0,
        resultHasChartData: finalChartData.length,
        chartDataObjKeys: Object.keys(chartDataObj),
      });

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
  conversationsTotal: number;
  conversationsHasMore: boolean;
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

  // Streaming state
  streamingConversationId: string | null;
  streamingMessageId: string | null;
  streamingQuestionMessageId: string | null;
  streamingComponents: StreamingComponent[];
  isStreaming: boolean;

  // Send state
  isAwaitingFirstChunk: boolean;
  awaitingConversationId: string | null;
  pendingAssistantMessageId: string | null;
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

  // Workspace selection
  selectedWorkspaceIds: string[];

  // Selected connector repository for the current conversation
  selectedConnectorRepo: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string } | null;

  // Deep search toggle
  deepSearchEnabled: boolean;

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
  updateConversation: (id: string, data: { title?: string; isArchived?: boolean; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }>; projectId?: string | null }) => Promise<void>;
  moveConversationToProject: (id: string, projectId: string | null) => Promise<void>;
  detachConversationsFromProject: (projectId: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  claimCurrentConversation: (id: string, conversation?: Conversation) => void;
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
  onConversationNameGenerated: (event: ConversationNameGeneratedEvent) => void;
  onMessageCreated: (event: MessageCreatedEvent) => void;
  onMessageUpdated: (event: MessageUpdatedEvent) => void;
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

  // Workspace selection
  setSelectedWorkspaceIds: (workspaceIds: string[]) => void;
  resetSelectedWorkspaceIds: () => void;

  // Connector repository selection
  setSelectedConnectorRepo: (repo: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string } | null) => void;

  // Deep search toggle
  setDeepSearchEnabled: (enabled: boolean) => void;

  // Skill selection (applied to every message in the conversation)
  setSelectedSkillIds: (skillIds: string[]) => void;
  toggleSelectedSkill: (skillId: string) => void;
  clearSelectedSkills: () => void;
  persistSelectedSkills: () => void;

  // Cleanup
  clearMessages: () => void;
  clearAll: () => void;
}

export const useConversationStore = create<ConversationState>()(
  devtools(
    (set, get) => ({
      // Initial state - flat array for conversations
      conversations: [],
      conversationsTotal: 0,
      conversationsHasMore: false,
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

      streamingConversationId: null,
      streamingMessageId: null,
      streamingQuestionMessageId: null,
      streamingComponents: [],
      isStreaming: false,

      isAwaitingFirstChunk: false,
      awaitingConversationId: null,
      pendingAssistantMessageId: null,
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
      selectedWorkspaceIds: [],
      selectedConnectorRepo: null,
      deepSearchEnabled: false,
      selectedSkillIds: [],

      streamingStateCache: new Map(),

      typewriterConversationId: null,
      typewriterName: null,
      mentionNavigationLock: false,

      // ===== Conversation Actions =====

      fetchConversations: async (params?: { reset?: boolean; limit?: number; search?: string; projectId?: string | 'none'; searchScope?: 'title' | 'fulltext' }) => {
        const reset = params?.reset ?? false;
        const limit = params?.limit || DEFAULT_CONVERSATIONS_LIMIT;

        if (reset) {
          set({ conversations: [], conversationsLoading: true });
        } else {
          set({ conversationsLoading: true });
        }

        try {
          const state = get();
          const offset = reset ? 0 : state.conversations.length;
          const page = Math.floor(offset / limit) + 1;

          const result = await api.fetchConversations({
            page,
            limit,
            search: params?.search,
            projectId: params?.projectId,
            searchScope: params?.searchScope,
          });

          set((s) => {
            const combined = reset ? result.items : [...s.conversations, ...result.items];

            // Dedupe by ID (safety for edge cases)
            const seen = new Set<string>();
            const deduped = combined.filter((c) => {
              if (seen.has(c.id)) return false;
              seen.add(c.id);
              return true;
            });

            return {
              conversations: deduped,
              conversationsTotal: result.total,
              conversationsHasMore: result.items.length === limit && deduped.length < result.total,
              conversationsLoading: false,
            };
          });
        } catch (err) {
          set({ conversationsLoading: false });
          toast.error(translateConversation('toasts.conversation.loadListError'));
          console.error('[ConversationStore] fetchConversations error:', err);
        }
      },

      fetchProjectConversations: async (projectId, options) => {
        const limit = options?.limit ?? 50;
        set((s) => ({
          projectConversationsLoading: { ...s.projectConversationsLoading, [projectId]: true },
        }));
        try {
          const result = await api.fetchConversations({ page: 1, limit, projectId });
          set((s) => ({
            projectConversations: { ...s.projectConversations, [projectId]: result.items },
            projectConversationsLoading: { ...s.projectConversationsLoading, [projectId]: false },
          }));
        } catch (err) {
          set((s) => ({
            projectConversationsLoading: { ...s.projectConversationsLoading, [projectId]: false },
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

          return conversation;
        } catch (err) {
          toast.error(translateConversation('toasts.conversation.createError'));
          throw err;
        }
      },

      updateConversation: async (id, data) => {
        const previousConversations = get().conversations;
        const previousProjectConversations = get().projectConversations;

        // Optimistic update — also reflect in any project list that contains it
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...data } : c)),
          projectConversations: mapProjectLists(s.projectConversations, (c) =>
            c.id === id ? { ...c, ...data } : c,
          ),
          currentConversation: s.currentConversation?.id === id ? { ...s.currentConversation, ...data } : s.currentConversation,
        }));

        try {
          const updated = await api.updateConversation(id, data);
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
            projectConversations: mapProjectLists(s.projectConversations, (c) =>
              c.id === id ? updated : c,
            ),
            currentConversation: s.currentConversation?.id === id ? updated : s.currentConversation,
          }));
        } catch (err) {
          set({ conversations: previousConversations, projectConversations: previousProjectConversations });
          toast.error(translateConversation('toasts.conversation.updateError'));
          throw err;
        }
      },

      moveConversationToProject: async (id, projectId) => {
        const state = get();
        const previousConversations = state.conversations;
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
          projectConversations: rebalanceProjectLists(
            s.projectConversations,
            id,
            sourceProjectId,
            projectId,
            optimistic,
          ),
          currentConversation:
            s.currentConversation?.id === id ? { ...s.currentConversation, projectId } : s.currentConversation,
        }));

        try {
          const updated = await api.updateConversation(id, { projectId });
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
            projectConversations: rebalanceProjectLists(
              s.projectConversations,
              id,
              sourceProjectId,
              projectId,
              updated,
            ),
            currentConversation:
              s.currentConversation?.id === id ? updated : s.currentConversation,
          }));
        } catch (err) {
          set({ conversations: previousConversations, projectConversations: previousProjectConversations });
          toast.error(translateConversation('toasts.conversation.updateError'));
          throw err;
        }
      },

      detachConversationsFromProject: (projectId) => {
        set((s) => {
          const { [projectId]: _removed, ...remainingLists } = s.projectConversations;
          const { [projectId]: _removedLoading, ...remainingLoading } = s.projectConversationsLoading;
          return {
            conversations: s.conversations.map((c) =>
              c.projectId === projectId ? { ...c, projectId: null } : c,
            ),
            projectConversations: remainingLists,
            projectConversationsLoading: remainingLoading,
            currentConversation:
              s.currentConversation?.projectId === projectId
                ? { ...s.currentConversation, projectId: null }
                : s.currentConversation,
          };
        });
      },

      deleteConversation: async (id) => {
        const state = get();
        const previousConversations = state.conversations;
        const previousProjectConversations = state.projectConversations;
        const previousTotal = state.conversationsTotal;

        // Optimistic removal from both lists
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          projectConversations: filterProjectLists(s.projectConversations, (c) => c.id !== id),
          conversationsTotal: Math.max(0, s.conversationsTotal - 1),
          currentConversation: s.currentConversation?.id === id ? null : s.currentConversation,
          currentConversationId: s.currentConversationId === id ? null : s.currentConversationId,
        }));

        try {
          await api.deleteConversation(id);
        } catch (err) {
          set({
            conversations: previousConversations,
            projectConversations: previousProjectConversations,
            conversationsTotal: previousTotal,
          });
          toast.error(translateConversation('toasts.conversation.deleteError'));
          throw err;
        }
      },

      claimCurrentConversation: (id, conversation) => {
        const cached = conversation ?? get().conversations.find((candidate) => candidate.id === id) ?? null;
        set({
          currentConversationId: id,
          currentConversation: cached,
          conversationLoading: false,
          selectedSkillIds: cached?.selectedSkills ?? [],
          selectedWorkspaceIds: cached?.workspaces ?? [],
        });
      },

      setCurrentConversation: async (id) => {
        const requestSequence = ++currentConversationRequestSequence;
        set({ conversationLoading: true, currentConversationId: id });
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
        set({ messagesLoading: true, messages: [] });

        try {
          const result = await api.fetchMessages(conversationId, {
            page: 1,
            limit: DEFAULT_MESSAGES_LIMIT,
          });

          const messages = result.items || [];

          // Find the last user message's modelId
          let lastUserModelId: string | null = null;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].conversationType === 'user' && messages[i].modelId) {
              lastUserModelId = messages[i].modelId!;
              break;
            }
          }

          // Fetch branches for all user messages that have answers, in parallel.
          // This prevents the loader from disappearing before branches are ready.
          const userMsgsWithAnswers = messages.filter((m) => m.conversationType === 'user' && m.answerMessageId);

          const branchResults = await Promise.allSettled(
            userMsgsWithAnswers.map((m) =>
              api.fetchBranches(conversationId, m.id).then((branches) => ({
                userMessageId: m.id,
                branches,
              })),
            ),
          );

          const newBranchCache = new Map(get().branchCache);
          const newActiveBranches = new Map(get().activeBranches);
          for (const result of branchResults) {
            if (result.status === 'fulfilled') {
              const { userMessageId, branches } = result.value;
              newBranchCache.set(userMessageId, branches);
              if (!newActiveBranches.has(userMessageId) && branches.length > 0) {
                newActiveBranches.set(userMessageId, branches[branches.length - 1].id);
              }
            }
          }

          set({
            messages,
            messagesTotal: result.total || 0,
            messagesHasMore: (result.totalPages || 1) > 1,
            messagesLoading: false,
            selectedModelId: lastUserModelId,
            branchCache: newBranchCache,
            activeBranches: newActiveBranches,
          });

          // Restore cached streaming state if this conversation is still streaming
          const cachedState = get().streamingStateCache.get(conversationId);
          if (cachedState) {
            // Remove from cache
            const newCache = new Map(get().streamingStateCache);
            newCache.delete(conversationId);

            // A terminal SSE event may have been missed while this conversation
            // was in the background. Persistence wins over stale live cache.
            const persistedMessage = cachedState.streamingMessageId
              ? messages.find((message) => message.id === cachedState.streamingMessageId)
              : undefined;
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
                streamingStateCache: newCache,
              });
              return;
            }

            // Set up the buffer flush callback so new chunks render live
            streamingBuffer.clear();
            streamingBuffer.setFlushCallback((chunks) => {
              set((s) => {
                const components = applyChunksToComponents(s.streamingComponents, chunks);
                const nextState: Partial<ConversationState> = { streamingComponents: components };
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
          }
        } catch (err) {
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

        try {
          // Calculate next page based on current message count
          const currentPage = Math.ceil(state.messages.length / DEFAULT_MESSAGES_LIMIT);
          const nextPage = currentPage + 1;

          const result = await api.fetchMessages(state.currentConversationId, {
            page: nextPage,
            limit: DEFAULT_MESSAGES_LIMIT,
          });

          set((s) => {
            // Prepend older messages, dedupe by ID
            const existingIds = new Set(s.messages.map((m) => m.id));
            const newMessages = (result.items || []).filter((m) => !existingIds.has(m.id));

            return {
              messages: [...newMessages, ...s.messages], // Prepend older
              messagesHasMore: nextPage < (result.totalPages || 1),
              messagesLoadingOlder: false,
            };
          });
        } catch (err) {
          set({ messagesLoadingOlder: false });
          toast.error(translateConversation('toasts.messages.loadError'));
          console.error('[ConversationStore] loadMoreMessages error:', err);
        }
      },

      sendMessage: async (conversationId, payload) => {
        const tempId = `temp-${Date.now()}`;
        const optimisticMsg: Message = {
          id: tempId,
          conversationId,
          conversationType: 'user',
          content: payload.content,
          interaction: payload.interaction,
          attachedFileIds: payload.attachedFileIds,
          attachedFiles: payload.attachedFiles,
          createdAt: new Date().toISOString(),
        };

        // Optimistic add
        set((s) => ({
          isAwaitingFirstChunk: !payload.memberIds?.length,
          awaitingConversationId: !payload.memberIds?.length ? conversationId : null,
          optimisticMessages: [...s.optimisticMessages, optimisticMsg],
        }));

        // Persist the conversation's skill selection (covers new conversations,
        // where toggles happened before the conversation existed).
        if (payload.skillIds?.length) {
          api
            .updateConversation(conversationId, { skillIds: payload.skillIds })
            .catch((err) => console.error('[ConversationStore] persist skills on send error:', err));
        }

        try {
          // Strip attachedFiles (frontend-only for optimistic display) before sending to API
          const { attachedFiles: _, ...apiPayload } = payload;
          // New conversations can submit before the app-level EventSource handshake finishes.
          // Keep the optimistic message visible while waiting briefly for stream delivery.
          if (!await conversationStreamService.waitForConnection()) {
            throw new Error(translateConversation('sse.connectionErrors.rejected'));
          }
          const result = await api.sendMessage(conversationId, apiPayload);

          // Replace optimistic message with real user message (with deduplication).
          // Patch sticky taggedAgentIds when the set actually changes.
          set((s) => {
            const alreadyExists = s.messages.some((m) => m.id === result.userMessage.id);
            const nextTaggedAgentIds = result.userMessage.agentIds?.length
              ? result.userMessage.agentIds
              : undefined;
            const prevTagged = s.currentConversation?.taggedAgentIds;
            const taggedChanged =
              !!nextTaggedAgentIds &&
              s.currentConversation?.id === conversationId &&
              (prevTagged?.length !== nextTaggedAgentIds.length ||
                nextTaggedAgentIds.some((agentId, i) => agentId !== prevTagged?.[i]));

            return {
              messages: alreadyExists ? s.messages : [...s.messages, result.userMessage],
              optimisticMessages: s.optimisticMessages.filter((m) => m.id !== tempId),
              messagesTotal: alreadyExists ? s.messagesTotal : s.messagesTotal + 1,
              selectedModelId: payload.modelId || s.selectedModelId,
              currentConversation: taggedChanged
                ? { ...s.currentConversation!, taggedAgentIds: nextTaggedAgentIds }
                : s.currentConversation,
              pendingAssistantMessageId: result.aiMessageId ?? s.pendingAssistantMessageId,
            };
          });
        } catch (err) {
          // Rollback optimistic message
          const apiError = parseApiError(err);
          set((s) => ({
            isAwaitingFirstChunk: false,
            awaitingConversationId: null,
            optimisticMessages: s.optimisticMessages.filter((m) => m.id !== tempId),
          }));

          // Handle MODEL_INACTIVE error - refresh models and clear selection
          if (apiError.code === ErrorCode.MODEL_INACTIVE) {
            toast.error(translateConversation('toasts.model.unavailableTitle'), {
              description: translateConversation('toasts.model.unavailableDescription'),
            });
            // Refresh models list to get updated active models
            useModelsStore.getState().refreshModels();
            // Clear selected model so it falls back to default
            set({ selectedModelId: null });
          } else {
            toast.error(translateConversation('toasts.messages.sendError'), { description: apiError.message });
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

        set({ isAwaitingFirstChunk: true, awaitingConversationId: conversationId, streamingQuestionMessageId: questionMsgId });
        try {
          await api.regenerateMessage(conversationId, messageId);
          // Streaming will handle the new response via SSE
        } catch (err) {
          const apiError = parseApiError(err);
          set({ isAwaitingFirstChunk: false, awaitingConversationId: null, streamingQuestionMessageId: null });

          // Handle MODEL_INACTIVE error - refresh models and clear selection
          if (apiError.code === ErrorCode.MODEL_INACTIVE) {
            toast.error(translateConversation('toasts.model.unavailableTitle'), {
              description: translateConversation('toasts.model.unavailableDescription'),
            });
            useModelsStore.getState().refreshModels();
            set({ selectedModelId: null });
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
        const state = get();

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
            ...(state.awaitingConversationId === event.conversationId ? {
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: event.messageId,
            } : {}),
          });
          return;
        }

        // Current conversation — clear any pending chunks from previous stream
        streamingBuffer.clear();

        // Set up the flush callback to batch-apply chunks
        streamingBuffer.setFlushCallback((chunks) => {
          set((s) => {
            const components = applyChunksToComponents(s.streamingComponents, chunks);
            const nextState: Partial<ConversationState> = { streamingComponents: components };
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
          streamingComponents: [],
          inputDisabled: false,
        });
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

        // Current conversation — buffer the chunk instead of immediately updating state
        streamingBuffer.addChunk(event.action, event.component);
      },

      onStreamComplete: async (event) => {
        const state = get();

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — clean cache, message is now persisted in DB
          const newCache = new Map(get().streamingStateCache);
          newCache.delete(event.conversationId);
          const clearCompletedStream =
            state.streamingConversationId === event.conversationId ||
            state.awaitingConversationId === event.conversationId ||
            state.pendingAssistantMessageId === event.messageId;
          set({
            streamingStateCache: newCache,
            ...(clearCompletedStream ? {
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: null,
            } : {}),
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

        // Flush any remaining buffered chunks and clear
        streamingBuffer.flush();
        streamingBuffer.clear();

        // Move plan component to the top immediately (before API fetch returns),
        // then chain-of-thought above it so it sits at the very top.
        set((s) => {
          const reordered = [...s.streamingComponents];

          const planIndex = reordered.findIndex((c) => c.type === 'plan');
          if (planIndex > 0) {
            const [plan] = reordered.splice(planIndex, 1);
            reordered.unshift(plan);
          }

          const cotIndex = reordered.findIndex((c) => c.type === 'chainOfThought');
          if (cotIndex > 0) {
            const [cot] = reordered.splice(cotIndex, 1);
            reordered.unshift(cot);
          }

          if (planIndex <= 0 && cotIndex <= 0) return s;
          return { streamingComponents: reordered };
        });

        // Fetch the completed message to get the persisted version
        try {
          const message = await api.fetchMessage(event.conversationId, event.messageId);

          set((s) => {
            const result = upsertMessage(s.messages, message);

            // Clean stale cache entry to prevent fetchMessages from restoring it
            const cleanedCache = new Map(s.streamingStateCache);
            cleanedCache.delete(event.conversationId);

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
              streamingStateCache: cleanedCache,
            };
          });

          // Refresh branches if this AI message has a questionMessageId — select latest
          if (message.questionMessageId) {
            get().fetchBranches(event.conversationId, message.questionMessageId, true);
          }

          // Refresh conversations list to update sidebar order (reset to get fresh order)
          get().fetchConversations({ reset: true });
        } catch (err) {
          console.error('[ConversationStore] onStreamComplete fetch error:', err);
          // Still clear streaming state and stale cache entry
          const cleanedCache = new Map(get().streamingStateCache);
          cleanedCache.delete(event.conversationId);
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
      },

      onStreamError: (event) => {
        const state = get();

        if (event.conversationId !== state.currentConversationId) {
          // Background conversation — clean cache
          const newCache = new Map(get().streamingStateCache);
          newCache.delete(event.conversationId);
          const clearFailedStream = state.streamingConversationId === event.conversationId || state.awaitingConversationId === event.conversationId;
          set({
            streamingStateCache: newCache,
            ...(clearFailedStream ? {
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
              awaitingConversationId: null,
              pendingAssistantMessageId: null,
            } : {}),
          });
          return;
        }

        // Clear any buffered chunks
        streamingBuffer.clear();

        const errorInfo = getStreamErrorMessage(event.errorCode);

        // Clean stale cache entry to prevent fetchMessages from restoring it
        const cleanedCache = new Map(get().streamingStateCache);
        cleanedCache.delete(event.conversationId);

        if (errorInfo.isCritical) {
          set({
            criticalError: { code: event.errorCode, message: errorInfo.description },
            inputDisabled: true,
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
            if (
              !clearedOptimistic &&
              m.id.startsWith('temp-') &&
              m.conversationType === 'user' &&
              event.message.conversationType === 'user' &&
              m.conversationId === event.conversationId &&
              m.content === event.message.content
            ) {
              clearedOptimistic = true;
              return false;
            }
            return true;
          });

          return {
            messages: [...s.messages, event.message],
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

        const existing = state.messages.find((message) => message.id === event.messageId);
        if (existing) {
          set((s) => ({
            messages: s.messages.map((message) => (message.id === event.messageId ? { ...message, ...event.message } : message)),
          }));
          return;
        }

        if (event.message.conversationType && event.message.createdAt) {
          const message = {
            ...event.message,
            id: event.messageId,
            conversationId: event.conversationId,
          } as Message;
          set((s) => {
            const result = upsertMessage(s.messages, message);
            return {
              messages: result.messages,
              messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
            };
          });
          return;
        }

        void api.fetchMessage(event.conversationId, event.messageId).then((message) => {
          if (get().currentConversationId !== event.conversationId) return;
          set((s) => {
            const result = upsertMessage(s.messages, message);
            return {
              messages: result.messages,
              messagesTotal: result.inserted ? s.messagesTotal + 1 : s.messagesTotal,
            };
          });
        }).catch((err) => console.error('[ConversationStore] message update reconciliation error:', err));
      },

      reconcilePendingStream: async () => {
        const state = get();
        const conversationId = state.streamingConversationId ?? state.awaitingConversationId;
        const messageId = state.streamingMessageId ?? state.pendingAssistantMessageId;
        if (!conversationId || !messageId) return;

        try {
          const message = await api.fetchMessage(conversationId, messageId);
          if (!message.isComplete || get().currentConversationId !== conversationId) return;

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
              streamingStateCache: cache,
            };
          });
        } catch (err) {
          console.error('[ConversationStore] pending stream reconciliation error:', err);
        }
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
                groupMeta: { ...s.currentConversation.groupMeta, members: updatedMembers },
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
        set({ selectedModelId: modelId });
      },

      // ===== Workspace Selection =====

      setSelectedWorkspaceIds: (workspaceIds) => {
        set({ selectedWorkspaceIds: workspaceIds });
      },

      resetSelectedWorkspaceIds: () => {
        set({ selectedWorkspaceIds: [] });
      },

      setSelectedConnectorRepo: (repo) => {
        set({ selectedConnectorRepo: repo });
      },

      setDeepSearchEnabled: (enabled) => {
        set({ deepSearchEnabled: enabled });
      },

      setSelectedSkillIds: (skillIds) => {
        set({ selectedSkillIds: skillIds });
        get().persistSelectedSkills();
      },

      toggleSelectedSkill: (skillId) => {
        set((s) => ({
          selectedSkillIds: s.selectedSkillIds.includes(skillId)
            ? s.selectedSkillIds.filter((id) => id !== skillId)
            : [...s.selectedSkillIds, skillId],
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
          .updateConversation(currentConversationId, { skillIds: selectedSkillIds })
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
          optimisticMessages: [],
          branchCache: new Map(),
          activeBranches: new Map(),
          editingMessageId: null,
          replyingToMessage: null,
          selectedModelId: null,
        });
      },

      clearAll: () => {
        streamingBuffer.clear();
        set({
          conversations: [],
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
const EMPTY_MESSAGES: Message[] = [];

export const useConversations = () => useConversationStore((s) => (s.conversations.length === 0 ? EMPTY_CONVERSATIONS : s.conversations));

export const useHistoryConversations = () =>
  useConversationStore(
    useShallow((s) => {
      const filtered = s.conversations.filter((c) => !c.projectId);
      return filtered.length === 0 ? EMPTY_CONVERSATIONS : filtered;
    }),
  );

export const useConversationsByProject = (projectId: string) =>
  useConversationStore(
    useShallow((s) => {
      const list = s.projectConversations[projectId];
      return !list || list.length === 0 ? EMPTY_CONVERSATIONS : list;
    }),
  );

export const useProjectConversationsLoading = (projectId: string) =>
  useConversationStore((s) => !!s.projectConversationsLoading[projectId]);

// ===== Project list helpers =====

function mapProjectLists(
  lists: Record<string, Conversation[]>,
  fn: (c: Conversation) => Conversation,
): Record<string, Conversation[]> {
  const next: Record<string, Conversation[]> = {};
  for (const [pid, arr] of Object.entries(lists)) {
    next[pid] = arr.map(fn);
  }
  return next;
}

function filterProjectLists(
  lists: Record<string, Conversation[]>,
  pred: (c: Conversation) => boolean,
): Record<string, Conversation[]> {
  const next: Record<string, Conversation[]> = {};
  for (const [pid, arr] of Object.entries(lists)) {
    next[pid] = arr.filter(pred);
  }
  return next;
}

function rebalanceProjectLists(
  lists: Record<string, Conversation[]>,
  conversationId: string,
  fromProjectId: string | null,
  toProjectId: string | null,
  conv: Conversation | null,
): Record<string, Conversation[]> {
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
      next[toProjectId] = exists
        ? targetList.map((c) => (c.id === conversationId ? conv : c))
        : [conv, ...targetList];
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
          return !s.messages.some(
            (msg) =>
              msg.conversationType === 'user' &&
              msg.conversationId === m.conversationId &&
              msg.content === m.content,
          );
        }
        return true;
      });

      if (newOptimistic.length === 0) {
        return s.messages.length === 0 ? EMPTY_MESSAGES : s.messages;
      }

      // Append optimistic messages (they're already newest)
      return [...s.messages, ...newOptimistic];
    }),
  );

export const useIsAwaitingFirstChunk = () => useConversationStore((s) => s.isAwaitingFirstChunk);
export const useAwaitingConversationId = () => useConversationStore((s) => s.awaitingConversationId);

export const useCriticalError = () => useConversationStore((s) => s.criticalError);

export const useInputDisabled = () => useConversationStore((s) => s.inputDisabled);

export const useMessagesHasMore = () => useConversationStore((s) => s.messagesHasMore);

export const useSSEError = () => useConversationStore((s) => s.sseError);

export const useSSEStatus = () => useConversationStore((s) => s.sseStatus);

export const useMessagesLoading = () => useConversationStore((s) => s.messagesLoading);

export const useIsInitialLoading = () => useConversationStore((s) => s.conversationLoading || s.messagesLoading);

export const useSelectedModelId = () => useConversationStore((s) => s.selectedModelId);

export const useSetSelectedModelId = () => useConversationStore((s) => s.setSelectedModelId);

export const useSelectedWorkspaceIds = () => useConversationStore((s) => s.selectedWorkspaceIds);

export const useSetSelectedWorkspaceIds = () => useConversationStore((s) => s.setSelectedWorkspaceIds);

export const useResetSelectedWorkspaceIds = () => useConversationStore((s) => s.resetSelectedWorkspaceIds);

export const useSelectedConnectorRepo = () => useConversationStore((s) => s.selectedConnectorRepo);

export const useSetSelectedConnectorRepo = () => useConversationStore((s) => s.setSelectedConnectorRepo);

export const useDeepSearchEnabled = () => useConversationStore((s) => s.deepSearchEnabled);

export const useSetDeepSearchEnabled = () => useConversationStore((s) => s.setDeepSearchEnabled);

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
            return !s.messages.some(
              (msg) =>
                msg.conversationType === 'user' &&
                msg.conversationId === m.conversationId &&
                msg.content === m.content,
            );
          }
          return true;
        });
        combined = newOptimistic.length === 0 ? s.messages : [...s.messages, ...newOptimistic];
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
