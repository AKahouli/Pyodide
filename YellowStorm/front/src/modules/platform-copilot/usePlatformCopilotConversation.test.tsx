import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_COPILOT_CONVERSATION_STORAGE_KEY, usePlatformCopilotConversation } from './usePlatformCopilotConversation';
import type { StreamSSEEvent } from '@/modules/conversation/types';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  fetchConversation: vi.fn(),
  fetchConversations: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  waitForConnection: vi.fn(),
  subscribe: vi.fn(),
  listener: undefined as ((event: StreamSSEEvent) => void) | undefined,
}));

vi.mock('@/modules/conversation/api', () => ({
  createConversation: mocks.createConversation,
  fetchConversation: mocks.fetchConversation,
  fetchConversations: mocks.fetchConversations,
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
}));

vi.mock('@/modules/conversation/stream', () => ({
  conversationStreamService: {
    waitForConnection: mocks.waitForConnection,
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
    mocks.fetchConversations.mockResolvedValue({ items: [{ id: 'conversation-1', title: 'Yellowmind', runtimePurpose: 'platform_copilot' }], total: 1, page: 1, limit: 100, totalPages: 1 });
    mocks.fetchMessages.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 });
    mocks.waitForConnection.mockResolvedValue(true);
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
    expect(result.current.streamingComponents).toEqual([expect.objectContaining({ id: 'text-1' })]);
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
    expect(result.current.streamingComponents[0]?.data.content).toBe('Hello world');
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

  it('does not start a turn when the shared Conversation stream is unavailable', async () => {
    mocks.waitForConnection.mockResolvedValue(false);
    const { result } = renderHook(() => usePlatformCopilotConversation(true, context));
    await waitFor(() => expect(result.current.conversationId).toBe('conversation-1'));

    await act(async () => { expect(await result.current.send('Find it')).toBe(false); });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result.current.error).toEqual(expect.objectContaining({ message: 'Conversation stream is unavailable' }));
  });
});
