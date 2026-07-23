import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChunksToComponents, useConversationStore } from './store';

const fetchConversationMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchConversation: fetchConversationMock,
  sendMessage: sendMessageMock,
}));

beforeEach(() => {
  fetchConversationMock.mockReset();
  sendMessageMock.mockReset();
  useConversationStore.setState({
    currentConversation: null,
    currentConversationId: null,
    conversationLoading: false,
    selectedWorkspaceIds: [],
    messages: [],
    optimisticMessages: [],
  });
});

describe('conversation optimistic messages', () => {
  it('preserves choice interaction display text while the request is pending', async () => {
    let resolveSend: (value: { userMessage: Record<string, unknown> }) => void = () => undefined;
    sendMessageMock.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
    const interaction = {
      type: 'choice' as const,
      componentId: 'choice-1',
      questionId: 'q1',
      sourceMessageId: '507f1f77bcf86cd799439011',
      selectionMode: 'single' as const,
      selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
      displayText: 'Profitability',
    };

    const pending = useConversationStore.getState().sendMessage('conv-1', {
      content: 'Analyze profitability with full canonical context',
      interaction,
    });

    expect(useConversationStore.getState().optimisticMessages[0]).toMatchObject({
      content: 'Analyze profitability with full canonical context',
      interaction,
    });

    resolveSend({
      userMessage: {
        id: 'message-1', conversationId: 'conv-1', conversationType: 'user',
        content: 'canonical content', interaction, createdAt: '2026-07-22T00:00:00.000Z',
      },
    });
    await pending;
  });
});

describe('conversation workspace selection', () => {
  it('hydrates and clears selected workspace ids when switching conversations', async () => {
    fetchConversationMock
      .mockResolvedValueOnce({ id: 'conv-1', workspaces: ['ws-1', 'ws-2'] })
      .mockResolvedValueOnce({ id: 'conv-2' });

    await useConversationStore.getState().setCurrentConversation('conv-1');
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual(['ws-1', 'ws-2']);

    await useConversationStore.getState().setCurrentConversation('conv-2');
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual([]);
  });

  it('ignores workspace hydration from a stale conversation request', async () => {
    let resolveFirst: (value: { id: string; workspaces: string[] }) => void = () => undefined;
    let resolveSecond: (value: { id: string; workspaces: string[] }) => void = () => undefined;
    fetchConversationMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const firstRequest = useConversationStore.getState().setCurrentConversation('conv-1');
    const secondRequest = useConversationStore.getState().setCurrentConversation('conv-2');
    resolveSecond({ id: 'conv-2', workspaces: ['ws-2'] });
    await secondRequest;
    resolveFirst({ id: 'conv-1', workspaces: ['ws-1'] });
    await firstRequest;

    expect(useConversationStore.getState().currentConversation?.id).toBe('conv-2');
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual(['ws-2']);
  });

  it('ignores a stale success when returning to the same conversation id', async () => {
    let resolveFirst: (value: { id: string; workspaces: string[] }) => void = () => undefined;
    fetchConversationMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ id: 'conv-2', workspaces: ['ws-2'] })
      .mockResolvedValueOnce({ id: 'conv-1', workspaces: ['ws-current'] });

    const staleRequest = useConversationStore.getState().setCurrentConversation('conv-1');
    await useConversationStore.getState().setCurrentConversation('conv-2');
    await useConversationStore.getState().setCurrentConversation('conv-1');
    resolveFirst({ id: 'conv-1', workspaces: ['ws-stale'] });
    await staleRequest;

    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual(['ws-current']);
  });

  it('ignores a stale failure when returning to the same conversation id', async () => {
    let rejectFirst: (reason: Error) => void = () => undefined;
    fetchConversationMock
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ id: 'conv-2', workspaces: ['ws-2'] })
      .mockResolvedValueOnce({ id: 'conv-1', workspaces: ['ws-current'] });

    const staleRequest = useConversationStore.getState().setCurrentConversation('conv-1');
    await useConversationStore.getState().setCurrentConversation('conv-2');
    await useConversationStore.getState().setCurrentConversation('conv-1');
    rejectFirst(new Error('stale request'));
    await staleRequest;

    expect(useConversationStore.getState().currentConversation?.id).toBe('conv-1');
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual(['ws-current']);
  });

  it('does not restore workspace selection after the current conversation is cleared', async () => {
    let resolveRequest: (value: { id: string; workspaces: string[] }) => void = () => undefined;
    fetchConversationMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));

    const pendingRequest = useConversationStore.getState().setCurrentConversation('conv-1');
    useConversationStore.setState({
      currentConversation: null,
      currentConversationId: null,
      selectedWorkspaceIds: [],
    });
    resolveRequest({ id: 'conv-1', workspaces: ['ws-stale'] });
    await pendingRequest;

    expect(useConversationStore.getState().currentConversation).toBeNull();
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual([]);
  });
});

describe('conversation streaming component updates', () => {
  it('merges tool metadata with the terminal response', () => {
    const components = applyChunksToComponents([], [
      {
        action: 'add',
        component: {
          id: 'tool-call-1',
          type: 'toolInfo',
          data: { title: 'search_documents', status: 'running', params: '{"query":"contract"}', startedAt: '2026-07-21T10:13:42Z' },
        },
      },
      {
        action: 'update',
        component: {
          id: 'tool-call-1',
          type: 'toolInfo',
          data: { title: 'search_documents', status: 'completed', params: '', resultJson: '{"matches":2}' },
        },
      },
    ] as never);

    expect(components).toEqual([
      {
        id: 'tool-call-1',
        type: 'toolInfo',
        data: {
          title: 'search_documents',
          status: 'completed',
          params: '{"query":"contract"}',
          startedAt: '2026-07-21T10:13:42Z',
          resultJson: '{"matches":2}',
        },
      },
    ]);
  });
});
