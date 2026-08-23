import * as React from 'react';
import { createConversation, fetchConversation, fetchConversations, fetchMessages, sendMessage } from '@/modules/conversation/api';
import { conversationStreamService } from '@/modules/conversation/stream';
import type { ChoiceInteractionMetadata, Conversation, Message, StreamingComponent, StreamSSEEvent } from '@/modules/conversation/types';
import type { PlatformCopilotPageContext } from './types';

export const PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY = 'ys_platform_copilot_conversation_id';
const LEGACY_CONVERSATION_STORAGE_KEY = 'ys_second_brain_conversation_id';

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

export function usePlatformCopilotConversation(open: boolean, clientContext: PlatformCopilotPageContext) {
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

  const hydrate = React.useCallback(async (id: string) => {
    const page = await fetchMessages(id, { limit: 100 });
    setMessages(page.items);
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
    if (!open || conversationId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
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
  }, [conversationId, hydrate, loadHistory, open]);

  React.useEffect(() => conversationStreamService.subscribe((event: StreamSSEEvent) => {
    if (!conversationId || !('data' in event) || !event.data || !('conversationId' in event.data) || event.data.conversationId !== conversationId) return;
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
        setStreamingMessageId(event.data.messageId);
        setStreamingComponents([]);
        break;
      case 'stream_chunk':
        setStreamingComponents((current) => applyStreamAction(current, event.data.action, event.data.component));
        break;
      case 'stream_complete':
        setStreamingComponents([]);
        setStreamingMessageId(undefined);
        void hydrate(conversationId).catch((hydrateError: unknown) => setError(hydrateError));
        void loadHistory();
        break;
      case 'stream_error':
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
  }), [conversationId, hydrate, loadHistory]);

  const send = async (content: string, interaction?: ChoiceInteractionMetadata, interactions?: ChoiceInteractionMetadata[]) => {
    if (!conversationId || loading) return false;
    setLoading(true);
    setError(undefined);
    const fingerprint = JSON.stringify({ content, interaction, interactions, clientContext });
    const requestId = retryRef.current?.fingerprint === fingerprint
      ? retryRef.current.requestId
      : crypto.randomUUID();
    retryRef.current = { fingerprint, requestId };
    try {
      const connected = await conversationStreamService.waitForConnection();
      if (!connected) throw new Error('Conversation stream is unavailable');
      const response = await sendMessage(conversationId, {
        content,
        requestId,
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
      setStreamingComponents([]);
      setStreamingMessageId(undefined);
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
