import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChunksToComponents, useConversationStore } from './store';

const fetchConversationMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const fetchMessageMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn());
const fetchBranchesMock = vi.hoisted(() => vi.fn());
const waitForConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('./stream', () => ({
  conversationStreamService: { waitForConnection: waitForConnectionMock },
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchConversation: fetchConversationMock,
  fetchConversations: fetchConversationsMock,
  sendMessage: sendMessageMock,
  fetchMessage: fetchMessageMock,
  fetchMessages: fetchMessagesMock,
  fetchBranches: fetchBranchesMock,
}));

beforeEach(() => {
  fetchConversationMock.mockReset();
  fetchConversationsMock.mockReset();
  sendMessageMock.mockReset();
  fetchMessageMock.mockReset();
  fetchMessagesMock.mockReset();
  fetchBranchesMock.mockReset();
  waitForConnectionMock.mockReset();
  fetchBranchesMock.mockResolvedValue([]);
  fetchConversationsMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 12, totalPages: 0 });
  waitForConnectionMock.mockResolvedValue(true);
  useConversationStore.setState({
    currentConversation: null,
    currentConversationId: null,
    conversationLoading: false,
    selectedWorkspaceIds: [],
    messages: [],
    optimisticMessages: [],
    messagesTotal: 0,
    isStreaming: false,
    streamingConversationId: null,
    streamingMessageId: null,
    streamingComponents: [],
    isAwaitingFirstChunk: false,
    awaitingConversationId: null,
    pendingAssistantMessageId: null,
    streamingStateCache: new Map(),
  });
});

describe('conversation optimistic messages', () => {
  it('waits for the app-level SSE handshake before sending a stream-producing message', async () => {
    let resolveConnection: (connected: boolean) => void = () => undefined;
    waitForConnectionMock.mockImplementation(() => new Promise((resolve) => { resolveConnection = resolve; }));
    sendMessageMock.mockResolvedValue({
      userMessage: {
        id: 'message-1',
        conversationId: 'conv-1',
        conversationType: 'user',
        content: 'hello',
        createdAt: '2026-07-26T00:00:00.000Z',
      },
    });

    const pending = useConversationStore.getState().sendMessage('conv-1', { content: 'hello' });

    expect(useConversationStore.getState().optimisticMessages).toHaveLength(1);
    expect(sendMessageMock).not.toHaveBeenCalled();

    resolveConnection(true);
    await pending;

    expect(sendMessageMock).toHaveBeenCalledWith('conv-1', { content: 'hello' });
  });

  it('does not send when the app-level SSE handshake cannot be established', async () => {
    waitForConnectionMock.mockResolvedValue(false);

    await expect(useConversationStore.getState().sendMessage('conv-1', { content: 'hello' })).rejects.toBeInstanceOf(Error);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(useConversationStore.getState().optimisticMessages).toHaveLength(0);
  });

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

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
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
  it('claims a new conversation before an early stream start arrives', () => {
    const conversation = { id: 'conv-1', title: 'New Conversation', workspaces: ['ws-1'] } as never;

    useConversationStore.getState().claimCurrentConversation('conv-1', conversation);
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-1' });

    expect(useConversationStore.getState()).toMatchObject({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
    });
    expect(useConversationStore.getState().streamingStateCache.has('conv-1')).toBe(false);
  });

  it('upserts a completed message update when its placeholder is absent', () => {
    useConversationStore.setState({ currentConversationId: 'conv-1', messages: [], messagesTotal: 0 });

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        conversationType: 'ai',
        components: [{ type: 'text', data: { content: 'Complete response' } }],
        isComplete: true,
        createdAt: '2026-07-23T10:00:00.000Z',
      },
    });

    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'ai-1', conversationId: 'conv-1', isComplete: true }),
    ]);
    expect(useConversationStore.getState().messagesTotal).toBe(1);
  });

  it('merges reliability metadata without replacing existing message fields', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      messages: [{
        id: 'ai-1',
        conversationId: 'conv-1',
        conversationType: 'ai',
        components: [{ type: 'text', data: { content: 'Complete response' } }],
        feedback: 'like',
        durationMs: 100,
        createdAt: '2026-07-23T10:00:00.000Z',
      }],
    });

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: { reliabilityEvaluation: {
        status: 'completed',
        score: 100,
        label: 'strongly_supported',
        claims: [{ claim: 'Complete response', status: 'supported', importance: 'major', explanation: 'Matched the source.' }],
      } },
    });

    expect(useConversationStore.getState().messages[0]).toMatchObject({
      feedback: 'like',
      durationMs: 100,
      components: [{ type: 'text', data: { content: 'Complete response' } }],
      reliabilityEvaluation: {
        status: 'completed',
        score: 100,
        claims: [{ claim: 'Complete response', status: 'supported' }],
      },
    });
  });

  it('preserves correction metadata when its update arrives before message fetch', async () => {
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      components: [{ type: 'text', data: { content: 'Original' } }],
      createdAt: '2026-07-26T10:00:00.000Z',
    });
    useConversationStore.setState({ currentConversationId: 'conv-1', messages: [], messagesTotal: 0 });
    const correctionWorkflow = {
      mode: 'corrective_transparent' as const, status: 'corrected' as const, activeVersion: 'corrected' as const,
      threshold: 70, attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning' as const,
      showOriginalAnswer: true, queuedAt: '2026-07-26T10:00:01.000Z',
      correctedComponents: [{ type: 'text' as const, data: { content: 'Corrected' } }],
    };

    useConversationStore.getState().onMessageUpdated({ conversationId: 'conv-1', messageId: 'ai-1', message: { correctionWorkflow } });
    await vi.waitFor(() => expect(useConversationStore.getState().messages).toHaveLength(1));

    expect(useConversationStore.getState().messages[0]).toMatchObject({
      components: [{ data: { content: 'Original' } }], correctionWorkflow,
    });
  });

  it('preserves correction and reliability metadata when a later fetch omits them', () => {
    const metadata = {
      reliabilityEvaluation: { status: 'completed' as const, score: 80 },
      correctionWorkflow: {
        mode: 'corrective_transparent' as const, status: 'corrected' as const, activeVersion: 'corrected' as const,
        threshold: 70, attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning' as const,
        showOriginalAnswer: true, queuedAt: '2026-07-26T10:00:01.000Z',
      },
    };
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      messages: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-26T10:00:00.000Z', ...metadata }],
    });
    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1', messageId: 'ai-1',
      message: { conversationType: 'ai', createdAt: '2026-07-26T10:00:00.000Z', components: [] },
    });
    expect(useConversationStore.getState().messages[0]).toMatchObject(metadata);
  });

  it('finalizes from the ordered canonical message without replacing it from REST', async () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      streamingComponents: [{ id: 'live-tool', type: 'toolInfo', data: { title: 'search', status: 'running' } }],
      messages: [{
        id: 'ai-1',
        conversationId: 'conv-1',
        conversationType: 'ai',
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { title: 'search', status: 'completed', startedAt: '2026-07-29T08:00:00.000Z' } },
          { id: 'tool-2', type: 'toolInfo', data: { title: 'read', status: 'completed', startedAt: '2026-07-29T08:00:04.000Z' } },
        ],
        isComplete: true,
        createdAt: '2026-07-29T08:00:00.000Z',
      }],
    });

    await useConversationStore.getState().onStreamComplete({ conversationId: 'conv-1', messageId: 'ai-1' });

    expect(fetchMessageMock).not.toHaveBeenCalled();
    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
      streamingComponents: [],
    });
    expect(useConversationStore.getState().messages[0].components).toHaveLength(2);

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: { reliabilityEvaluation: { status: 'failed', failureCode: 'source_check_failed' } },
    });
    expect(useConversationStore.getState().messages[0].reliabilityEvaluation).toEqual({
      status: 'failed',
      failureCode: 'source_check_failed',
    });
  });

  it('reconciles a persisted completion after the live event was missed', async () => {
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1',
      conversationId: 'conv-1',
      conversationType: 'ai',
      components: [{ type: 'text', data: { content: 'Recovered response' } }],
      isComplete: true,
      createdAt: '2026-07-23T10:00:00.000Z',
    });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
    });

    await useConversationStore.getState().reconcilePendingStream();

    expect(fetchMessageMock).toHaveBeenCalledWith('conv-1', 'ai-1');
    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
      messagesTotal: 1,
    });
  });

  it('does not let fallback REST replace a newer canonical completion update', async () => {
    let resolveFetch: (message: unknown) => void = () => undefined;
    fetchMessageMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      messages: [],
      messagesTotal: 0,
    });

    const completion = useConversationStore.getState().onStreamComplete({ conversationId: 'conv-1', messageId: 'ai-1' });
    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        conversationType: 'ai',
        components: [{ id: 'tool-1', type: 'toolInfo', data: { title: 'search', status: 'completed' } }],
        reliabilityEvaluation: { status: 'completed', score: 100 },
        isComplete: true,
        createdAt: '2026-07-29T08:00:00.000Z',
      },
    });
    resolveFetch({
      id: 'ai-1',
      conversationId: 'conv-1',
      conversationType: 'ai',
      components: [{ id: 'text-1', type: 'text', data: { content: 'Early snapshot' } }],
      isComplete: true,
      createdAt: '2026-07-29T08:00:00.000Z',
    });
    await completion;

    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({
        components: [expect.objectContaining({ type: 'toolInfo' })],
        reliabilityEvaluation: { status: 'completed', score: 100 },
      }),
    ]);
    expect(useConversationStore.getState().messagesTotal).toBe(1);
  });

  it('does not restore stale background streaming state over a persisted completion', async () => {
    fetchMessagesMock.mockResolvedValue({
      items: [{
        id: 'ai-1',
        conversationId: 'conv-1',
        conversationType: 'ai',
        components: [{ type: 'text', data: { content: 'Completed while hidden' } }],
        isComplete: true,
        createdAt: '2026-07-23T10:00:00.000Z',
      }],
      total: 1,
      totalPages: 1,
    });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      streamingStateCache: new Map([['conv-1', {
        streamingMessageId: 'ai-1',
        streamingQuestionMessageId: null,
        streamingComponents: [{ id: 'text-1', type: 'text', data: { content: 'Partial' } }],
        isAwaitingFirstChunk: false,
      }]]),
    });

    await useConversationStore.getState().fetchMessages('conv-1');

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
    });
    expect(useConversationStore.getState().streamingStateCache.has('conv-1')).toBe(false);
  });

  it('merges public tool metadata without retaining raw results', () => {
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
        },
      },
    ]);
  });

  it('upserts out-of-order tools without collapsing repeated names or regressing status', () => {
    const components = applyChunksToComponents([], [
      { action: 'update', component: { id: 'tool-agent-call-1', type: 'toolInfo', data: { title: 'search', status: 'completed', resultJson: '{"matches":1}' } } },
      { action: 'add', component: { id: 'tool-agent-call-1', type: 'toolInfo', data: { title: 'search', status: 'running', params: '{"q":"one"}' } } },
      { action: 'add', component: { id: 'tool-agent-call-2', type: 'toolInfo', data: { title: 'search', status: 'running', params: '{"q":"two"}' } } },
      { action: 'add', component: { id: 'tool-agent-call-2', type: 'toolInfo', data: { title: 'search', status: 'running', params: '{"q":"two"}' } } },
    ] as never);

    expect(components).toHaveLength(2);
    expect(components[0].data).toMatchObject({ status: 'completed', params: '{"q":"one"}' });
    expect(components[0].data).not.toHaveProperty('resultJson');
    expect(components[1].data).toMatchObject({ status: 'running', params: '{"q":"two"}' });
  });
});
