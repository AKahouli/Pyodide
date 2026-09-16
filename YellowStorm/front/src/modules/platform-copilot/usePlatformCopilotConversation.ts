import * as React from 'react';
import { createConversation, fetchActiveStream, fetchConversation, fetchConversations, fetchMessages, fetchToolResult, sendMessage } from '@/modules/conversation/api';
import { conversationStreamService } from '@/modules/conversation/stream';
import type { ChoiceInteractionMetadata, Conversation, Message, MessageComponent, StreamingComponent, StreamSSEEvent } from '@/modules/conversation/types';
import type { PlatformCopilotPageContext } from './types';
import type { PendingPlaybookHandoffDraft } from './platformCopilotPanelStore';

export const PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY = 'ys_platform_copilot_conversation_id';
const LEGACY_CONVERSATION_STORAGE_KEY = 'ys_second_brain_conversation_id';

/**
 * Persisted message responses omit tool result payloads; the copilot derives
 * its UI handoff targets from them, so pull each missing payload on demand.
 * A failed lookup only costs that tool's handoff targets, not the hydrate.
 */
async function hydrateToolResults(conversationId: string, messages: Message[]): Promise<Message[]> {
  return Promise.all(messages.map(async (message) => {
    if (message.conversationType !== 'ai') return message;
    const tools = (message.components ?? []).filter(
      (component): component is MessageComponent & { id: string } =>
        component.type === 'toolActivity'
        && Boolean(component.id)
        && (component.data as Record<string, unknown>).resultJson === undefined,
    );
    if (tools.length === 0) return message;
    const payloads = await Promise.all(tools.map(async (component) => {
      try {
        return (await fetchToolResult(conversationId, message.id, component.id)).resultJson;
      } catch (err) {
        console.warn('[PlatformCopilot] tool result hydration failed; handoff targets may be missing', err);
        return undefined;
      }
    }));
    const resultById = new Map(tools.map((component, index) => [component.id, payloads[index]]));
    return {
      ...message,
      components: (message.components ?? []).map((component) => {
        const resultJson = component.type === 'toolActivity' && component.id ? resultById.get(component.id) : undefined;
        return resultJson
          ? { ...component, data: { ...component.data, resultJson } }
          : component;
      }),
    };
  }));
}

function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = { ...next[index], ...message };
  return next;
}

function mergeStreamData(component: StreamingComponent, incoming: StreamingComponent): StreamingComponent {
  if (component.type === 'text' || component.type === 'agentActivity' || component.type === 'code') {
    const existingContent = typeof component.data.content === 'string' ? component.data.content : '';
    const incomingContent = typeof incoming.data.content === 'string' ? incoming.data.content : '';
    return { ...component, ...incoming, data: { ...component.data, ...incoming.data, content: existingContent + incomingContent } };
  }
  if (component.type === 'toolActivity') {
    const existingStatus = component.data.status;
    const status = existingStatus === 'completed' || existingStatus === 'failed'
      ? existingStatus
      : incoming.data.status ?? existingStatus;
    return { ...component, ...incoming, data: { ...component.data, ...incoming.data, status } };
  }
  return { ...component, ...incoming, data: { ...incoming.data } };
}

function applyStreamAction(
  components: StreamingComponent[],
  action: 'add' | 'update' | 'delete',
  component: StreamingComponent,
): StreamingComponent[] {
  const index = components.findIndex((candidate) => candidate.id === component.id);
  if (action === 'delete') return index < 0 ? components : components.filter((_, itemIndex) => itemIndex !== index);
  if (index < 0) return [...components, component];
  const next = [...components];
  next[index] = mergeStreamData(next[index], component);
  return next;
}

export function usePlatformCopilotConversation(open: boolean, clientContext: PlatformCopilotPageContext, pendingHandoff?: PendingPlaybookHandoffDraft | null) {
  const [conversationId, setConversationId] = React.useState<string>();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [streamingComponents, setStreamingComponents] = React.useState<StreamingComponent[]>([]);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string>();
  const [history, setHistory] = React.useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>();
  const retryRef = React.useRef<{ fingerprint: string; requestId: string }>();
  const newConversationRequestRef = React.useRef<string>();
  const conversationIdRef = React.useRef<string>();
  const hydrateGenerationRef = React.useRef(0);
  const recoveryRef = React.useRef<{
    conversationId: string;
    messageId?: string;
    terminal: boolean;
    chunks: Array<Extract<StreamSSEEvent, { type: 'stream_chunk' }>['data']>;
  }>();

  const hydrate = React.useCallback(async (id: string) => {
    const generation = ++hydrateGenerationRef.current;
    const previousConversationId = conversationIdRef.current;
    conversationIdRef.current = id;
    const recovery: NonNullable<typeof recoveryRef.current> = {
      conversationId: id,
      terminal: false,
      chunks: [],
    };
    recoveryRef.current = recovery;
    try {
      const [page, activeStream] = await Promise.all([
        fetchMessages(id, { limit: 100 }),
        fetchActiveStream(id).catch(() => null),
      ]);
      let hydratedMessages = await hydrateToolResults(id, page.items);
      if (hydrateGenerationRef.current !== generation) return;
      if (recovery.terminal) {
        const latest = await fetchMessages(id, { limit: 100 });
        hydratedMessages = await hydrateToolResults(id, latest.items);
      }
      if (hydrateGenerationRef.current !== generation) return;
      setMessages(hydratedMessages);
      if (activeStream && !recovery.terminal) {
        const components = recovery.chunks
          .filter((chunk) => chunk.revision === undefined || chunk.revision > activeStream.revision)
          .reduce((current, chunk) => applyStreamAction(current, chunk.action, chunk.component), activeStream.components);
        setStreamingMessageId(activeStream.messageId);
        setStreamingComponents(components);
      } else if (!recovery.terminal && recovery.messageId) {
        setStreamingMessageId(recovery.messageId);
        setStreamingComponents(recovery.chunks.reduce(
          (current, chunk) => applyStreamAction(current, chunk.action, chunk.component),
          [] as StreamingComponent[],
        ));
      } else {
        setStreamingMessageId(undefined);
        setStreamingComponents([]);
      }
    } catch (error) {
      if (hydrateGenerationRef.current === generation) conversationIdRef.current = previousConversationId;
      throw error;
    } finally {
      if (recoveryRef.current === recovery) recoveryRef.current = undefined;
    }
  }, []);

  const loadHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const page = await fetchConversations({
        runtimePurpose: 'platform_copilot',
        page: 1,
        limit: 100,
        sortBy: 'lastMessageAt',
        sortOrder: 'desc',
      });
      setHistory(page.items);
    } catch (historyError: unknown) {
      setError(historyError);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open || (conversationId && conversationId === pendingHandoff?.platformConversationId) || (conversationId && !pendingHandoff)) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      if (pendingHandoff) {
        const prepared = await fetchConversation(pendingHandoff.platformConversationId);
        if (prepared.runtimePurpose !== 'platform_copilot') throw new Error('Prepared Yellowmind conversation is invalid');
        await hydrate(prepared.id);
        if (!cancelled) {
          setConversationId(prepared.id);
          void loadHistory();
        }
        return;
      }
      const legacyId = localStorage.getItem(LEGACY_CONVERSATION_STORAGE_KEY);
      const storedId = localStorage.getItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY) ?? legacyId;
      if (legacyId && !localStorage.getItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY)) {
        localStorage.setItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, legacyId);
        localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
      }
      let conversation;
      if (storedId) {
        try {
          const candidate = await fetchConversation(storedId);
          if (candidate.runtimePurpose === 'platform_copilot') conversation = candidate;
        } catch {
          localStorage.removeItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY);
        }
      }
      conversation ??= await createConversation({ runtimePurpose: 'platform_copilot' });
      if (cancelled) return;
      localStorage.setItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, conversation.id);
      await hydrate(conversation.id);
      if (!cancelled) {
        setConversationId(conversation.id);
        void loadHistory();
      }
    })().catch((initializationError: unknown) => {
      if (!cancelled) setError(initializationError);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, hydrate, loadHistory, open, pendingHandoff]);

  React.useEffect(() => conversationStreamService.subscribe((event: StreamSSEEvent) => {
    const activeConversationId = conversationIdRef.current;
    if (event.type === 'stream_resync_required') {
      if (activeConversationId) void hydrate(activeConversationId).catch((hydrateError: unknown) => setError(hydrateError));
      return;
    }
    if (!activeConversationId || !('data' in event) || !event.data || !('conversationId' in event.data) || event.data.conversationId !== activeConversationId) return;
    const recovery = recoveryRef.current?.conversationId === activeConversationId ? recoveryRef.current : undefined;
    switch (event.type) {
      case 'message_created':
        setMessages((current) => upsertMessage(current, event.data.message));
        break;
      case 'message_updated':
        setMessages((current) => {
          const existing = current.find((message) => message.id === event.data.messageId);
          return existing ? upsertMessage(current, { ...existing, ...event.data.message } as Message) : current;
        });
        break;
      case 'stream_start':
        if (recovery) {
          recovery.messageId = event.data.messageId;
          break;
        }
        setStreamingMessageId(event.data.messageId);
        setStreamingComponents([]);
        break;
      case 'stream_chunk':
        if (recovery) {
          recovery.messageId ??= event.data.messageId;
          recovery.chunks.push(event.data);
          break;
        }
        setStreamingComponents((current) => applyStreamAction(current, event.data.action, event.data.component));
        break;
      case 'stream_complete':
        if (recovery) recovery.terminal = true;
        setStreamingComponents([]);
        setStreamingMessageId(undefined);
        if (!recovery) void hydrate(activeConversationId).catch((hydrateError: unknown) => setError(hydrateError));
        void loadHistory();
        break;
      case 'stream_error':
        if (recovery) recovery.terminal = true;
        setStreamingComponents([]);
        setStreamingMessageId(undefined);
        setLoading(false);
        break;
      case 'conversation_name_generated':
        setHistory((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, title: event.data.name }
          : conversation));
        break;
    }
  }), [hydrate, loadHistory]);

  const send = async (content: string, interaction?: ChoiceInteractionMetadata, interactions?: ChoiceInteractionMetadata[], handoff?: PendingPlaybookHandoffDraft) => {
    if (!conversationId || loading) return false;
    setLoading(true);
    setError(undefined);
    const fingerprint = JSON.stringify({ content, interaction, interactions, clientContext, playbookHandoffId: handoff?.handoffId });
    const requestId = handoff?.messageRequestId ?? (retryRef.current?.fingerprint === fingerprint
      ? retryRef.current.requestId
      : crypto.randomUUID());
    retryRef.current = { fingerprint, requestId };
    try {
      // POST starts immediately; the shared SSE pipe connects in parallel and
      // the server replays any events missed by the (re)connecting pipe.
      conversationStreamService.ensureConnected();
      const response = await sendMessage(conversationId, {
        content,
        requestId,
        playbookHandoffId: handoff?.handoffId,
        clientContext,
        interaction,
        interactions,
      });
      setMessages((current) => upsertMessage(current, response.userMessage));
      if (response.aiMessageId) {
        setStreamingMessageId(response.aiMessageId);
        setStreamingComponents([]);
      }
      retryRef.current = undefined;
      return true;
    } catch (sendError: unknown) {
      setError(sendError);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const selectConversation = async (id: string) => {
    if (id === conversationId || loading || streamingMessageId) return id === conversationId;
    setLoading(true);
    setError(undefined);
    try {
      const conversation = await fetchConversation(id);
      if (conversation.runtimePurpose !== 'platform_copilot') return false;
      await hydrate(id);
      conversationIdRef.current = id;
      setConversationId(id);
      localStorage.setItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, id);
      return true;
    } catch (selectionError: unknown) {
      setError(selectionError);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const createNewConversation = async () => {
    if (loading || streamingMessageId) return false;
    setLoading(true);
    setError(undefined);
    newConversationRequestRef.current ??= crypto.randomUUID();
    try {
      const conversation = await createConversation({
        runtimePurpose: 'platform_copilot',
        creationRequestId: newConversationRequestRef.current,
      });
      newConversationRequestRef.current = undefined;
      setMessages([]);
      setStreamingComponents([]);
      setStreamingMessageId(undefined);
      conversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      localStorage.setItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, conversation.id);
      setHistory((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      return true;
    } catch (creationError: unknown) {
      setError(creationError);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    conversationId,
    messages,
    streamingComponents,
    streamingMessageId,
    history,
    historyLoading,
    loading,
    error,
    send,
    selectConversation,
    createNewConversation,
    refreshHistory: loadHistory,
  };
}
