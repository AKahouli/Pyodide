import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/api-error';
import { ErrorCode } from '@/lib/error-codes';
import { useModelsStore } from '@/modules/models/store';
import * as api from './api';
import { getStreamErrorMessage } from './utils';
import { translateConversation } from './translation';
import type { Conversation, Message, StreamingComponent, SendMessagePayload, CreateReportPayload, StreamStartEvent, StreamChunkEvent, StreamCompleteEvent, StreamErrorEvent, ConversationNameGeneratedEvent, SSEConnectionStatus, MessageCreatedEvent, MessageUpdatedEvent } from './types';

export const DEFAULT_CONVERSATIONS_LIMIT = 12;
const DEFAULT_MESSAGES_LIMIT = 5;

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
function applyChunksToComponents(
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
      // Charts and other structured components replace the full payload on update.
      return { ...incoming };
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

  // Stream state cache for background conversations
  streamingStateCache: Map<string, CachedStreamingState>;

  // Typewriter state for name generation
  typewriterConversationId: string | null;
  typewriterName: string | null;

  // Unread mentions counter
  unreadMentions: number;
  mentionNavigationLock: boolean;

  // Actions - Conversations
  fetchConversations: (params?: { reset?: boolean; limit?: number; search?: string }) => Promise<void>;
  createConversation: (data?: { title?: string; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }>; ownerJob?: string }) => Promise<Conversation>;
  updateConversation: (id: string, data: { title?: string; isArchived?: boolean; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }> }) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
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

      streamingStateCache: new Map(),

      typewriterConversationId: null,
      typewriterName: null,
      mentionNavigationLock: false,

      // ===== Conversation Actions =====

      fetchConversations: async (params?: { reset?: boolean; limit?: number; search?: string }) => {
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

      createConversation: async (data) => {
        try {
          const conversation = await api.createConversation(data);

          // Immediately prepend to list - appears at top
          set((s) => ({
            conversations: [conversation, ...s.conversations],
            conversationsTotal: s.conversationsTotal + 1,
          }));

          return conversation;
        } catch (err) {
          toast.error(translateConversation('toasts.conversation.createError'));
          throw err;
        }
      },

      updateConversation: async (id, data) => {
        const previousConversations = get().conversations;

        // Optimistic update
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...data } : c)),
          currentConversation: s.currentConversation?.id === id ? { ...s.currentConversation, ...data } : s.currentConversation,
        }));

        try {
          const updated = await api.updateConversation(id, data);
          set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
            currentConversation: s.currentConversation?.id === id ? updated : s.currentConversation,
          }));
        } catch (err) {
          // Rollback on failure
          set({ conversations: previousConversations });
          toast.error(translateConversation('toasts.conversation.updateError'));
          throw err;
        }
      },

      deleteConversation: async (id) => {
        const state = get();
        const previousConversations = state.conversations;
        const previousTotal = state.conversationsTotal;

        // Optimistic removal
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          conversationsTotal: Math.max(0, s.conversationsTotal - 1),
          currentConversation: s.currentConversation?.id === id ? null : s.currentConversation,
          currentConversationId: s.currentConversationId === id ? null : s.currentConversationId,
        }));

        try {
          await api.deleteConversation(id);
        } catch (err) {
          // Rollback on failure
          set({ conversations: previousConversations, conversationsTotal: previousTotal });
          toast.error(translateConversation('toasts.conversation.deleteError'));
          throw err;
        }
      },

      setCurrentConversation: async (id) => {
        set({ conversationLoading: true, currentConversationId: id });
        try {
          const conversation = await api.fetchConversation(id);
          set({ currentConversation: conversation, conversationLoading: false });
        } catch (err) {
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
          attachedFileIds: payload.attachedFileIds,
          attachedFiles: payload.attachedFiles,
          createdAt: new Date().toISOString(),
        };

        // Optimistic add
        set((s) => ({
          isAwaitingFirstChunk: !payload.memberIds?.length,
          optimisticMessages: [...s.optimisticMessages, optimisticMsg],
        }));

        try {
          // Strip attachedFiles (frontend-only for optimistic display) before sending to API
          const { attachedFiles: _, ...apiPayload } = payload;
          const result = await api.sendMessage(conversationId, apiPayload);

          // Replace optimistic message with real user message (with deduplication)
          set((s) => {
            // Check if message already exists (avoid duplicates from race with fetchMessages)
            const alreadyExists = s.messages.some((m) => m.id === result.userMessage.id);

            return {
              messages: alreadyExists ? s.messages : [...s.messages, result.userMessage],
              optimisticMessages: s.optimisticMessages.filter((m) => m.id !== tempId),
              messagesTotal: alreadyExists ? s.messagesTotal : s.messagesTotal + 1,
              selectedModelId: payload.modelId || s.selectedModelId,
            };
          });
        } catch (err) {
          // Rollback optimistic message
          const apiError = parseApiError(err);
          set((s) => ({
            isAwaitingFirstChunk: false,
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

        set({ isAwaitingFirstChunk: true, streamingQuestionMessageId: questionMsgId });
        try {
          await api.regenerateMessage(conversationId, messageId);
          // Streaming will handle the new response via SSE
        } catch (err) {
          const apiError = parseApiError(err);
          set({ isAwaitingFirstChunk: false, streamingQuestionMessageId: null });

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
          set({ streamingStateCache: newCache });
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
            }
            return nextState;
          });
        });

        set({
          isStreaming: true,
          streamingConversationId: event.conversationId,
          streamingMessageId: event.messageId,
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
          set({ streamingStateCache: newCache });
          // Refresh conversations list to update sidebar order
          get().fetchConversations({ reset: true });
          return;
        }

        // Flush any remaining buffered chunks and clear
        streamingBuffer.flush();
        streamingBuffer.clear();

        // Move plan component to the top immediately (before API fetch returns)
        set((s) => {
          const planIndex = s.streamingComponents.findIndex((c) => c.type === 'plan');
          if (planIndex <= 0) return s;
          const reordered = [...s.streamingComponents];
          const [plan] = reordered.splice(planIndex, 1);
          reordered.unshift(plan);
          return { streamingComponents: reordered };
        });

        // Fetch the completed message to get the persisted version
        try {
          const message = await api.fetchMessage(event.conversationId, event.messageId);

          set((s) => {
            // Check if message already exists (could be added by fetchMessages race)
            const existingIndex = s.messages.findIndex((m) => m.id === event.messageId);

            let updatedMessages: Message[];
            if (existingIndex >= 0) {
              // Replace existing with complete version
              updatedMessages = [...s.messages];
              updatedMessages[existingIndex] = message;
            } else {
              // Append if not found
              updatedMessages = [...s.messages, message];
            }

            // Clean stale cache entry to prevent fetchMessages from restoring it
            const cleanedCache = new Map(s.streamingStateCache);
            cleanedCache.delete(event.conversationId);

            return {
              messages: updatedMessages,
              isStreaming: false,
              streamingConversationId: null,
              streamingMessageId: null,
              streamingQuestionMessageId: null,
              streamingComponents: [],
              isAwaitingFirstChunk: false,
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
          set({ streamingStateCache: newCache });
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

        set((s) => ({
          messages: [...s.messages, event.message],
          messagesTotal: s.messagesTotal + 1,
          // Clear optimistic if it matches (by requestId if available, or temporary ID)
          optimisticMessages: s.optimisticMessages.filter((m) => m.id !== event.message.id),
        }));

        // Refresh conversations list to update sidebar order
        get().fetchConversations({ reset: true });
      },

      onMessageUpdated: (event) => {
        const state = get();
        if (event.conversationId !== state.currentConversationId) return;

        set((s) => ({
          messages: s.messages.map((m) => (m.id === event.messageId ? { ...m, ...event.message } : m)),
        }));
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

      // ===== Cleanup =====

      clearMessages: () => {
        const state = get();
        const convId = state.streamingConversationId || state.currentConversationId;

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
      // Combine messages with optimistic messages, dedupe by ID
      if (s.optimisticMessages.length === 0) {
        return s.messages.length === 0 ? EMPTY_MESSAGES : s.messages;
      }

      const seenIds = new Set(s.messages.map((m) => m.id));
      const newOptimistic = s.optimisticMessages.filter((m) => !seenIds.has(m.id));

      if (newOptimistic.length === 0) {
        return s.messages.length === 0 ? EMPTY_MESSAGES : s.messages;
      }

      // Append optimistic messages (they're already newest)
      return [...s.messages, ...newOptimistic];
    }),
  );

export const useIsAwaitingFirstChunk = () => useConversationStore((s) => s.isAwaitingFirstChunk);

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
      // Combine messages with optimistic messages, dedupe by ID
      let combined: Message[];
      if (s.optimisticMessages.length === 0) {
        combined = s.messages;
      } else {
        const seenIds = new Set(s.messages.map((m) => m.id));
        const newOptimistic = s.optimisticMessages.filter((m) => !seenIds.has(m.id));
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
