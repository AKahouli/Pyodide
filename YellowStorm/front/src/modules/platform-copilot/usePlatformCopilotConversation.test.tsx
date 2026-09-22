import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, usePlatformCopilotConversation } from './usePlatformCopilotConversation';
import type { StreamSSEEvent } from '@/modules/conversation/types';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  fetchActiveStream: vi.fn(),
  fetchConversation: vi.fn(),
  fetchConversations: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  ensureConnected: vi.fn(),
  subscribe: vi.fn(),
  listener: undefined as ((event: StreamSSEEvent) => void) | undefined,
}));

vi.mock('@/modules/conversation/api', () => ({
  createConversation: mocks.createConversation,
  fetchActiveStream: mocks.fetchActiveStream,
  fetchConversation: mocks.fetchConversation,
  fetchConversations: mocks.fetchConversations,
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
}));

vi.mock('@/modules/conversation/stream', () => ({
  conversationStreamService: {
    ensureConnected: mocks.ensureConnected,
    subscribe: mocks.subscribe,
  },
}));

const context = {
  contextVersion: 1 as const,
  route: '/playbooks',
  module: 'playbooks' as const,
  surface: 'playbook.list',
  availableActions: ['search'],
  hasUnsavedChanges: false,
  locale: 'en',
};

describe('usePlatformCopilotConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY);
    mocks.listener = undefined;
    mocks.subscribe.mockImplementation((listener: (event: StreamSSEEvent) => void) => {
      mocks.listener = listener;
      return vi.fn();
    });
    mocks.createConversation.mockResolvedValue({ id: 'conversation-1', runtimePurpose: 'platform_copilot' });
    mocks.fetchActiveStream.mockResolvedValue(null);
    mocks.fetchConversations.mockResolvedValue({ items: [{ id: 'conversation-1', title: 'Yellowmind', runtimePurpose: 'platform_copilot' }], total: 1, page: 1, limit: 100, totalPages: 1 });
    mocks.fetchMessages.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 });
    mocks.sendMessage.mockResolvedValue({
      userMessage: {
        id: 'user-1', conversationId: 'conversation-1', conversationType: 'user', content: 'Find it',
        webSearchEnabled: false, isStreaming: false, isComplete: true, createdAt: new Date().toISOString(),
      },
      aiMessageId: 'ai-1',
    });
  });

  it('creates a standard platform-copilot conversation and sends typed context', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));
    expect(result.current.loading).toBe(false);

    await act(async () => { await result.current.send('Find it'); });

    expect(mocks.createConversation).toHaveBeenCalledWith({ runtimePurpose: 'platform_copilot' });
    expect(mocks.sendMessage).toHaveBeenCalledWith('conversation-1', expect.objectContaining({
      content: 'Find it',
      requestId: expect.any(String),
      clientContext: context,
    }));
    expect(localStorage.getItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY)).toBe('conversation-1');
  });

  it('hydrates and sends the prepared handoff on its dedicated conversation', async () => {
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-handoff', runtimePurpose: 'platform_copilot' });
    const pendingHandoff = {
      handoffId: crypto.randomUUID(),
      platformConversationId: 'conversation-handoff',
      suggestedPrompt: 'Create a reusable Playbook',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      messageRequestId: crypto.randomUUID(),
      preview: { executionSummaries: [], planSteps: [], actions: [], resources: [], omissions: {} },
    };
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context, pendingHandoff));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-handoff'));

    await act(async () => { expect(await result.current.send(pendingHandoff.suggestedPrompt, undefined, undefined, pendingHandoff)).toBe(true); });

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith('conversation-handoff', expect.objectContaining({
      content: pendingHandoff.suggestedPrompt,
      requestId: pendingHandoff.messageRequestId,
      playbookHandoffId: pendingHandoff.handoffId,
    }));
  });

  it('migrates the legacy conversation storage key once', async () => {
    localStorage.setItem('ys_second_brain_conversation_id', 'conversation-1');
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-1', runtimePurpose: 'platform_copilot' });
    mocks.fetchMessages.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 });

    renderHook(() => usePlatformCopilotConversation(true, context));

    await waitFor(() => expect(localStorage.getItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY)).toBe('conversation-1'));
    expect(localStorage.getItem('ys_second_brain_conversation_id')).toBeNull();
  });

  it('filters the shared stream by the pinned conversation id', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: {
        conversationId: 'other', action: 'add', component: { id: 'ignored', type: 'text', data: { content: 'No' } },
      },
    }));
    expect(result.current.streamingComponents).toEqual([]);

    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: {
        conversationId: 'conversation-1', action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'Yes' } },
      },
    }));
    await waitFor(() => expect(result.current.streamingComponents).toEqual([expect.objectContaining({ id: 'text-1' })]));
  });

  it('tracks one streaming AI message and accumulates component updates', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    act(() => mocks.listener?.({
      type: 'stream_start',
      data: { conversationId: 'conversation-1', messageId: 'ai-1' },
    }));
    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: { conversationId: 'conversation-1', action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'Hello ' } } },
    }));
    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: { conversationId: 'conversation-1', action: 'update', component: { id: 'text-1', type: 'text', data: { content: 'world' } } },
    }));

    expect(result.current.streamingMessageId).toBe('ai-1');
    await waitFor(() => expect(result.current.streamingComponents[0]?.data.content).toBe('Hello world'));
  });

  it('does not commit a queued frame after the stream completes', async () => {
    mocks.fetchMessages
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 })
      .mockResolvedValueOnce({ items: [{ id: 'ai-1', conversationId: 'conversation-1', conversationType: 'ai', isComplete: true, components: [] }], total: 1, page: 1, limit: 100, totalPages: 1 });
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    act(() => {
      mocks.listener?.({ type: 'stream_start', data: { conversationId: 'conversation-1', messageId: 'ai-1' } });
      mocks.listener?.({
        type: 'stream_chunk',
        data: { conversationId: 'conversation-1', messageId: 'ai-1', action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'stale' } } },
      });
      mocks.listener?.({ type: 'stream_complete', data: { conversationId: 'conversation-1', messageId: 'ai-1' } });
    });

    await waitFor(() => expect(result.current.messages).toEqual([expect.objectContaining({ id: 'ai-1' })]));
    expect(result.current.streamingMessageId).toBeUndefined();
    expect(result.current.streamingComponents).toEqual([]);
  });

  it('restores an active Yellowmind stream after a page refresh', async () => {
    localStorage.setItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, 'conversation-1');
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-1', runtimePurpose: 'platform_copilot' });
    mocks.fetchActiveStream.mockResolvedValue({
      conversationId: 'conversation-1',
      messageId: 'ai-live',
      revision: 3,
      components: [{ id: 'activity-1', type: 'agentActivity', data: { content: 'Checking available Playbooks' } }],
    });

    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));

    await waitFor(() => expect(result.current.streamingMessageId).toBe('ai-live'));
    expect(mocks.fetchActiveStream).toHaveBeenCalledWith('conversation-1');
    expect(result.current.streamingComponents).toEqual([
      expect.objectContaining({ id: 'activity-1', data: { content: 'Checking available Playbooks' } }),
    ]);
  });

  it('applies live chunks that arrive while the active stream snapshot is loading', async () => {
    let resolveActiveStream!: (value: Record<string, unknown>) => void;
    mocks.fetchActiveStream.mockImplementation(() => new Promise((resolve) => { resolveActiveStream = resolve; }));
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));

    await waitFor(() => expect(mocks.fetchActiveStream).toHaveBeenCalledWith('conversation-1'));
    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: { conversationId: 'conversation-1', messageId: 'ai-live', revision: 4, action: 'update', component: { id: 'activity-1', type: 'agentActivity', data: { content: ' then checking access' } } },
    }));
    resolveActiveStream({
      conversationId: 'conversation-1', messageId: 'ai-live', revision: 3,
      components: [{ id: 'activity-1', type: 'agentActivity', data: { content: 'Checking Playbooks' } }],
    });

    await waitFor(() => expect(result.current.streamingComponents[0]?.data.content).toBe(' then checking access'));
  });

  it('does not resurrect a stream that completes while recovery is loading', async () => {
    let resolveActiveStream!: (value: Record<string, unknown>) => void;
    mocks.fetchActiveStream.mockImplementation(() => new Promise((resolve) => { resolveActiveStream = resolve; }));
    mocks.fetchMessages
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 })
      .mockResolvedValueOnce({ items: [{ id: 'ai-live', conversationId: 'conversation-1', conversationType: 'ai', isComplete: true, components: [] }], total: 1, page: 1, limit: 100, totalPages: 1 });
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));

    await waitFor(() => expect(mocks.fetchActiveStream).toHaveBeenCalled());
    act(() => mocks.listener?.({ type: 'stream_complete', data: { conversationId: 'conversation-1', messageId: 'ai-live' } }));
    resolveActiveStream({
      conversationId: 'conversation-1', messageId: 'ai-live', revision: 3,
      components: [{ id: 'activity-1', type: 'agentActivity', data: { content: 'Stale activity' } }],
    });

    await waitFor(() => expect(result.current.messages).toEqual([expect.objectContaining({ id: 'ai-live', isComplete: true })]));
    expect(result.current.streamingMessageId).toBeUndefined();
    expect(result.current.streamingComponents).toEqual([]);
  });

  it('keeps message history when active stream recovery is unavailable', async () => {
    mocks.fetchActiveStream.mockRejectedValue(new Error('snapshot unavailable'));
    mocks.fetchMessages.mockResolvedValue({ items: [{ id: 'saved', conversationId: 'conversation-1', conversationType: 'user', content: 'Hello' }], total: 1, page: 1, limit: 100, totalPages: 1 });

    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));

    await waitFor(() => expect(result.current.messages).toEqual([expect.objectContaining({ id: 'saved' })]));
    expect(result.current.error).toBeUndefined();
  });

  it('reconciles from the active stream snapshot when replay continuity is lost', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));
    mocks.fetchActiveStream.mockResolvedValue({
      conversationId: 'conversation-1', messageId: 'ai-live', revision: 9,
      components: [{ id: 'activity-1', type: 'agentActivity', data: { content: 'Recovered activity' } }],
    });

    act(() => mocks.listener?.({ type: 'stream_resync_required', data: { reason: 'cursor_gap' } }));

    await waitFor(() => expect(result.current.streamingComponents).toEqual([
      expect.objectContaining({ id: 'activity-1', data: { content: 'Recovered activity' } }),
    ]));
  });

  it('creates a distinct idempotent conversation without deleting prior history', async () => {
    mocks.createConversation
      .mockResolvedValueOnce({ id: 'conversation-1', runtimePurpose: 'platform_copilot' })
      .mockResolvedValueOnce({ id: 'conversation-2', title: 'Yellowmind', runtimePurpose: 'platform_copilot' });
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    await act(async () => { expect(await result.current.createNewConversation()).toBe(true); });

    expect(mocks.createConversation).toHaveBeenLastCalledWith({
      runtimePurpose: 'platform_copilot',
      creationRequestId: expect.any(String),
    });
    expect(result.current.conversationId).toBe('conversation-2');
    expect(localStorage.getItem(PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY)).toBe('conversation-2');
    expect(result.current.history.map((conversation) => conversation.id)).toEqual([
      'conversation-2',
      'conversation-1',
    ]);

    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-1', runtimePurpose: 'platform_copilot' });
    mocks.fetchMessages.mockResolvedValue({
      items: [{ id: 'old-message', conversationId: 'conversation-1', content: 'Remember this' }],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    });
    await act(async () => { expect(await result.current.selectConversation('conversation-1')).toBe(true); });
    expect(result.current.messages).toEqual([expect.objectContaining({ id: 'old-message' })]);
  });

  it('loads and selects an owned platform-copilot history item', async () => {
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-2', runtimePurpose: 'platform_copilot' });
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    await act(async () => { expect(await result.current.selectConversation('conversation-2')).toBe(true); });

    expect(mocks.fetchConversation).toHaveBeenCalledWith('conversation-2');
    expect(result.current.conversationId).toBe('conversation-2');
  });

  it('keeps a recovered active stream when selecting conversation history', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-2', runtimePurpose: 'platform_copilot' });
    mocks.fetchActiveStream.mockResolvedValue({
      conversationId: 'conversation-2', messageId: 'ai-live', revision: 2,
      components: [{ id: 'activity-1', type: 'agentActivity', data: { content: 'Still working' } }],
    });

    await act(async () => { expect(await result.current.selectConversation('conversation-2')).toBe(true); });

    expect(result.current.streamingMessageId).toBe('ai-live');
    expect(result.current.streamingComponents).toEqual([expect.objectContaining({ id: 'activity-1' })]);
  });

  it('keeps the previous stream owner when conversation selection hydration fails', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));
    mocks.fetchConversation.mockResolvedValue({ id: 'conversation-2', runtimePurpose: 'platform_copilot' });
    mocks.fetchMessages.mockRejectedValueOnce(new Error('history unavailable'));

    await act(async () => { expect(await result.current.selectConversation('conversation-2')).toBe(false); });
    act(() => mocks.listener?.({
      type: 'stream_chunk',
      data: { conversationId: 'conversation-1', messageId: 'ai-live', revision: 1, action: 'add', component: { id: 'activity-1', type: 'agentActivity', data: { content: 'Continued' } } },
    }));

    expect(result.current.conversationId).toBe('conversation-1');
    await waitFor(() => expect(result.current.streamingComponents).toEqual([expect.objectContaining({ id: 'activity-1' })]));
  });

  it('starts the turn without waiting for the shared Conversation stream', async () => {
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    await act(async () => { expect(await result.current.send('Find it')).toBe(true); });

    expect(mocks.ensureConnected).toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith('conversation-1', expect.objectContaining({ content: 'Find it' }));
  });

  it('surfaces POST failures without conflating them with stream connection state', async () => {
    mocks.sendMessage.mockRejectedValue(new Error('POST failed'));
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    await act(async () => { expect(await result.current.send('Find it')).toBe(false); });
    expect(result.current.error).toEqual(expect.objectContaining({ message: 'POST failed' }));
  });
});
