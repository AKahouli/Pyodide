import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChunksToComponents, useConversationStore } from './store';
import { useModelsStore } from '@/modules/models';

const fetchConversationMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const fetchMessageMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn());
const fetchActiveStreamMock = vi.hoisted(() => vi.fn());
const fetchBranchesMock = vi.hoisted(() => vi.fn());
const ensureConnectedMock = vi.hoisted(() => vi.fn());

vi.mock('./stream', () => ({
  conversationStreamService: { ensureConnected: ensureConnectedMock },
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchConversation: fetchConversationMock,
  fetchConversations: fetchConversationsMock,
  sendMessage: sendMessageMock,
  fetchMessage: fetchMessageMock,
  fetchMessages: fetchMessagesMock,
  fetchActiveStream: fetchActiveStreamMock,
  fetchBranches: fetchBranchesMock,
}));

beforeEach(() => {
  fetchConversationMock.mockReset();
  fetchConversationsMock.mockReset();
  sendMessageMock.mockReset();
  fetchMessageMock.mockReset();
  fetchMessageMock.mockResolvedValue({ isComplete: false });
  fetchMessagesMock.mockReset();
  fetchActiveStreamMock.mockReset();
  fetchBranchesMock.mockReset();
  ensureConnectedMock.mockReset();
  fetchBranchesMock.mockResolvedValue([]);
  fetchActiveStreamMock.mockResolvedValue(null);
  fetchConversationsMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 12, totalPages: 0 });
  useConversationStore.setState({
    currentConversation: null,
    currentConversationId: null,
    conversationLoading: false,
    selectedModelId: null,
    selectedWorkspaceIds: [],
    selectedSemanticModelId: null,
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
    pendingTerminalErrorKey: null,
    earlyStreamErrors: new Map(),
    inFlightSendConversations: new Set(),
    streamingStateCache: new Map(),
    criticalError: null,
    inputDisabled: false,
  });
});

  it('keeps workspace and semantic model selections mutually exclusive', () => {
    useConversationStore.getState().setSelectedWorkspaceIds(['ws-1']);
    useConversationStore.getState().setSelectedSemanticModelId('semantic-1');
    expect(useConversationStore.getState().selectedWorkspaceIds).toEqual(['ws-1']);
    expect(useConversationStore.getState().selectedSemanticModelId).toBe('semantic-1');

    useConversationStore.getState().setSelectedWorkspaceIds(['ws-2']);
    expect(useConversationStore.getState().selectedSemanticModelId).toBeNull();
  });

describe('conversation optimistic messages', () => {
  it('sends the POST immediately while nudging the shared SSE pipe without awaiting it', async () => {
    sendMessageMock.mockResolvedValue({
      userMessage: {
        id: 'message-1',
        conversationId: 'conv-1',
        conversationType: 'user',
        content: 'hello',
        createdAt: '2026-07-26T00:00:00.000Z',
      },
    });

    await useConversationStore.getState().sendMessage('conv-1', { content: 'hello' });

    expect(ensureConnectedMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith('conv-1', { content: 'hello' });
    // Optimistic message replaced by the persisted user message.
    expect(useConversationStore.getState().optimisticMessages).toHaveLength(0);
    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'message-1', content: 'hello' }),
    ]);
  });

  it('refetches canonical messages when the server reports a stream resync', async () => {
    fetchMessagesMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, totalPages: 0 });
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    useConversationStore.getState().onStreamResyncRequired({ reason: 'cursor_gap', lastSeenCursor: 'boot-1:9' });

    await vi.waitFor(() => expect(fetchMessagesMock).toHaveBeenCalledWith('conv-1', expect.anything()));
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

  it('applies a scoped stream error that arrives before the send response', async () => {
    let resolveSend: (value: { userMessage: Record<string, unknown>; aiMessageId: string }) => void = () => undefined;
    sendMessageMock.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    const pending = useConversationStore.getState().sendMessage('conv-1', { content: 'hello' });
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    useConversationStore.getState().onMessageCreated({
      conversationId: 'conv-1',
      message: {
        id: 'message-1', conversationId: 'conv-1', conversationType: 'user',
        content: 'hello', createdAt: '2026-08-31T18:14:58.000Z',
      },
    });
    expect(useConversationStore.getState().optimisticMessages).toHaveLength(0);
    expect(useConversationStore.getState().inFlightSendConversations.has('conv-1')).toBe(true);
    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1417',
      message: 'Limit reached',
    });

    expect(useConversationStore.getState().criticalError).toBeNull();
    resolveSend({
      userMessage: {
        id: 'message-1', conversationId: 'conv-1', conversationType: 'user',
        content: 'hello', createdAt: '2026-08-31T18:14:58.000Z',
      },
      aiMessageId: 'ai-1',
    });
    await pending;

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      isAwaitingFirstChunk: false,
      pendingAssistantMessageId: null,
      inputDisabled: true,
      criticalError: { code: 'ERR_1417' },
    });
    expect(useConversationStore.getState().earlyStreamErrors.size).toBe(0);
    expect(useConversationStore.getState().inFlightSendConversations.size).toBe(0);
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

describe('conversation live activity', () => {
  const nextFrame = () =>
    new Promise<void>((resolve) =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0),
    );

  it('applies activity and answer text in one frame commit', async () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isAwaitingFirstChunk: true,
      awaitingConversationId: 'conv-1',
      streamingComponents: [],
    });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'message-1' });

    const store = useConversationStore.getState();
    store.onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'activity-1', type: 'agentActivity', data: { summary: '', status: 'completed' } },
    });
    store.onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', status: 'running', summary: 'Read the research explanation', renderKind: 'code' } },
    });
    store.onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', status: 'completed', summary: '', renderKind: 'generic', resultJson: '{"ok":true}' } },
    });
    store.onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'Final answer' } },
    });
    await nextFrame();

    expect(useConversationStore.getState().streamingComponents).toEqual([
      { id: 'activity-1', type: 'agentActivity', data: { summary: '', status: 'completed' } },
      {
        id: 'tool-1',
        type: 'toolActivity',
        data: expect.objectContaining({
          toolName: 'run_code',
          status: 'completed',
          summary: 'Read the research explanation',
          renderKind: 'code',
          resultJson: '{"ok":true}',
        }),
      },
      { id: 'text-1', type: 'text', data: { content: 'Final answer' } },
    ]);
    expect(useConversationStore.getState().isAwaitingFirstChunk).toBe(false);
  });

  it('coalesces text and activity chunks into one ordered commit per frame', async () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      streamingComponents: [],
    });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'message-1' });
    useConversationStore.setState({ streamingComponents: [{ id: 'activity-1', type: 'agentActivity', data: { summary: 'Planning', status: 'running' } }] });
    const store = useConversationStore.getState();
    store.onStreamChunk({ conversationId: 'conv-1', action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'First. ' } } });
    store.onStreamChunk({ conversationId: 'conv-1', action: 'add', component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running', summary: 'Find sources' } } });
    store.onStreamChunk({ conversationId: 'conv-1', action: 'update', component: { id: 'activity-1', type: 'agentActivity', data: { summary: 'Sources selected', status: 'completed' } } });
    await nextFrame();

    expect(useConversationStore.getState().streamingComponents).toEqual([
      { id: 'activity-1', type: 'agentActivity', data: { summary: 'Sources selected', status: 'completed' } },
      { id: 'text-1', type: 'text', data: { content: 'First. ' } },
      { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running', summary: 'Find sources' } },
    ]);
  });
});

describe('new conversation selections', () => {
  it('accepts legacy model records without reasoning metadata', () => {
    useModelsStore.setState({ models: [{ id: 'legacy-model' } as never] });

    expect(() => useConversationStore.getState().setSelectedModelId('legacy-model')).not.toThrow();
    expect(useConversationStore.getState().selectedReasoningEffort).toBeNull();
  });

  it('claims the submitted model and workspaces before route hydration', () => {
    const conversation = { id: 'conv-1', title: 'New Conversation' } as never;

    useConversationStore.getState().claimCurrentConversation('conv-1', conversation, {
      modelId: 'model-1',
      workspaceIds: ['ws-1'],
    });

    expect(useConversationStore.getState()).toMatchObject({
      currentConversationId: 'conv-1',
      selectedModelId: 'model-1',
      selectedWorkspaceIds: ['ws-1'],
    });
  });

  it('preserves a claimed model when the initial message history is empty', async () => {
    fetchMessagesMock.mockResolvedValue({ items: [], total: 0, totalPages: 0 });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      selectedModelId: 'model-1',
    });

    await useConversationStore.getState().fetchMessages('conv-1');

    expect(useConversationStore.getState().selectedModelId).toBe('model-1');
  });

  it('ignores message hydration from the previously active conversation', async () => {
    let resolvePreviousFetch: (value: {
      items: Array<{ id: string; conversationType: string; modelId: string }>;
      total: number;
      totalPages: number;
    }) => void = () => undefined;
    fetchMessagesMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePreviousFetch = resolve; }),
    );
    useConversationStore.setState({ currentConversationId: 'conv-previous' });

    const previousFetch = useConversationStore.getState().fetchMessages('conv-previous');
    useConversationStore.getState().claimCurrentConversation(
      'conv-new',
      { id: 'conv-new', title: 'New Conversation' } as never,
      { modelId: 'model-new', workspaceIds: ['ws-new'] },
    );
    resolvePreviousFetch({
      items: [{ id: 'message-previous', conversationType: 'user', modelId: 'model-previous' }],
      total: 1,
      totalPages: 1,
    });
    await previousFetch;

    expect(useConversationStore.getState()).toMatchObject({
      currentConversationId: 'conv-new',
      selectedModelId: 'model-new',
      selectedWorkspaceIds: ['ws-new'],
      messages: [],
    });
  });

  it('hydrates the last persisted user model from message history', async () => {
    fetchMessagesMock.mockResolvedValue({
      items: [
        { id: 'message-1', conversationType: 'user', modelId: 'model-2' },
        { id: 'message-2', conversationType: 'ai' },
      ],
      total: 2,
      totalPages: 1,
    });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      selectedModelId: 'model-1',
    });

    await useConversationStore.getState().fetchMessages('conv-1');

    expect(useConversationStore.getState().selectedModelId).toBe('model-2');
  });

  it('clears the previous model when switching conversations', async () => {
    fetchConversationMock.mockResolvedValue({ id: 'conv-2', workspaces: [] });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      selectedModelId: 'model-1',
    });

    await useConversationStore.getState().setCurrentConversation('conv-2');

    expect(useConversationStore.getState().selectedModelId).toBeNull();
  });
});

describe('conversation streaming component updates', () => {
  it('repairs dropped chunks from the active-stream snapshot on queue overflow', async () => {
    fetchActiveStreamMock.mockResolvedValue({
      conversationId: 'conv-1',
      messageId: 'message-1',
      revision: 501,
      components: [{ id: 'text-snap', type: 'text', data: { content: 'Snapshot body' } }],
    });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      streamingComponents: [],
    });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'message-1' });

    const store = useConversationStore.getState();
    for (let i = 0; i < 501; i += 1) {
      store.onStreamChunk({
        conversationId: 'conv-1',
        action: 'update',
        component: { id: 'text-stream', type: 'text', data: { content: `chunk ${i}` } },
        revision: i + 1,
      });
    }
    // A brand-new component created after the overflow dropped the backlog.
    store.onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'text-tail', type: 'text', data: { content: 'Tail' } },
      revision: 503,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1');
    // The snapshot is the canonical base; the live tail applied during the
    // fetch is preserved as a local-only component after it.
    const components = useConversationStore.getState().streamingComponents;
    expect(components).toHaveLength(2);
    expect(components[0]).toEqual({ id: 'text-snap', type: 'text', data: { content: 'Snapshot body' } });
    expect(components[1]).toMatchObject({ id: 'text-tail', data: { content: 'Tail' } });

    // The live tail keeps merging onto the repaired base.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-tail', type: 'text', data: { content: 'Tail grows' } },
      revision: 504,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'text-snap', type: 'text', data: { content: 'Snapshot body' } }),
      expect.objectContaining({ id: 'text-tail', type: 'text', data: { content: 'TailTail grows' } }),
    ]);
  });

  it('recovers progressive content when revisioned chunks arrive before any stream_start', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    // Cold send: the SSE pipe was not open when the backend emitted
    // stream_start, so revisioned chunks arrive with no observed start.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'early ' } },
      revision: 1,
    });
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-1', type: 'text', data: { content: 'early tail' } },
      revision: 2,
    });
    // Recovery is keyed by conversation — it works even before the POST ack
    // has supplied the message id.
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1'));

    resolveSnapshot({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 2,
      components: [{ id: 'text-1', type: 'text', data: { content: 'early tail' } }],
    });

    await vi.waitFor(() => {
      expect(useConversationStore.getState()).toMatchObject({
        isStreaming: true,
        streamingConversationId: 'conv-1',
        streamingMessageId: 'ai-1',
        pendingAssistantMessageId: 'ai-1',
        isAwaitingFirstChunk: false,
      });
    });

    // Post-install deltas apply live instead of re-buffering into recovery.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-1', type: 'text', data: { content: ' more' } },
      revision: 3,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'text-1', data: { content: 'early tail more' } }),
    ]);
  });

  it('forced resync installs the snapshot for a live run instead of skipping it', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-1' });

    // Render through revision 2, then miss the 3..250 span.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-1', type: 'text', data: { content: 'partial' } },
      revision: 2,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    useConversationStore.getState().onStreamResyncRequired({ reason: 'cursor_gap' });
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1'));

    // Deltas arriving while the snapshot is in flight are held, not applied.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-1', type: 'text', data: { content: 'HOLD' } },
      revision: 251,
    });

    resolveSnapshot({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 250,
      components: [{ id: 'text-1', type: 'text', data: { content: 'repaired span' } }],
    });

    await vi.waitFor(() => {
      expect(useConversationStore.getState().streamingComponents).toEqual([
        expect.objectContaining({ id: 'text-1', data: { content: 'repaired spanHOLD' } }),
      ]);
    });
    // The gap was repaired without a disruptive canonical list reload.
    expect(fetchMessagesMock).not.toHaveBeenCalled();

    // Only deltas newer than the snapshot apply afterwards.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'update',
      component: { id: 'text-1', type: 'text', data: { content: ' tail' } },
      revision: 252,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'text-1', data: { content: 'repaired spanHOLD tail' } }),
    ]);
  });

  it('forced resync ignores the snapshot after the user navigated away', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-1' });

    useConversationStore.getState().onStreamResyncRequired({ reason: 'cursor_gap' });
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1'));

    useConversationStore.setState({ currentConversationId: 'conv-2' });
    resolveSnapshot({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 9,
      components: [{ id: 'text-9', type: 'text', data: { content: 'stale' } }],
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState().streamingComponents).toEqual([]);
    expect(fetchMessagesMock).not.toHaveBeenCalled();
  });

  it('forced resync defers to canonical completion that lands during the snapshot fetch', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });
    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-1' });

    useConversationStore.getState().onStreamResyncRequired({ reason: 'cursor_gap' });
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1'));

    fetchMessageMock.mockResolvedValue({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      isComplete: true, components: [], createdAt: '2026-09-06T00:00:00.000Z',
    });
    await useConversationStore.getState().onStreamComplete({ conversationId: 'conv-1', messageId: 'ai-1' });
    expect(useConversationStore.getState().isStreaming).toBe(false);

    resolveSnapshot({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 9,
      components: [{ id: 'text-9', type: 'text', data: { content: 'late snapshot' } }],
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // The completion owns the terminal state; the snapshot must not
    // resurrect the stream or trigger a canonical reload.
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().streamingComponents).toEqual([]);
    expect(fetchMessagesMock).not.toHaveBeenCalled();
  });

  it('missing-start recovery defers to a terminal event that lands during the snapshot fetch', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    // Cold send: chunks arrive with no observed start; recovery kicks off.
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'early' } },
      revision: 1,
    });
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalledWith('conv-1'));

    // The run settles terminally while the snapshot is in flight.
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      isComplete: true, components: [], createdAt: '2026-09-06T00:00:00.000Z',
    });
    useConversationStore.setState({ streamingMessageId: 'ai-1', pendingAssistantMessageId: 'ai-1' });
    await useConversationStore.getState().onStreamComplete({ conversationId: 'conv-1', messageId: 'ai-1' });
    expect(useConversationStore.getState().isStreaming).toBe(false);

    resolveSnapshot({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 5,
      components: [{ id: 'text-1', type: 'text', data: { content: 'late snapshot' } }],
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // The terminal state wins; the snapshot must not resurrect the stream.
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().streamingComponents).toEqual([]);
    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'ai-1', isComplete: true }),
    ]);
  });

  it('restores an active stream snapshot after refresh and keeps applying live chunks', async () => {
    fetchMessagesMock.mockResolvedValue({
      items: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        questionMessageId: 'user-1', components: [], isStreaming: true, isComplete: false,
      }],
      total: 1,
      totalPages: 1,
    });
    fetchActiveStreamMock.mockResolvedValue({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      revision: 1,
      components: [{ id: 'text-1', type: 'text', data: { content: 'Recovered partial answer' } }],
    });
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    await useConversationStore.getState().fetchMessages('conv-1');
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      action: 'add',
      component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running' } },
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      isAwaitingFirstChunk: false,
    });
    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'text-1', data: { content: 'Recovered partial answer' } }),
      expect.objectContaining({ id: 'tool-1', data: expect.objectContaining({ status: 'running' }) }),
    ]);
  });

  it('keeps a canonical completion that arrives during stale message hydration', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchMessagesMock.mockResolvedValue({
      items: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false }],
      total: 1,
      totalPages: 1,
    });
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    const hydration = useConversationStore.getState().fetchMessages('conv-1');
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalled());
    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        conversationType: 'ai', components: [{ id: 'text-1', type: 'text', data: { content: 'Complete' } }],
        isStreaming: false, isComplete: true, createdAt: '2026-08-23T14:00:00.000Z',
      },
    });
    resolveSnapshot({
      conversationId: 'conv-1', messageId: 'ai-1', revision: 1,
      components: [{ id: 'text-1', type: 'text', data: { content: 'Partial' } }],
    });
    await hydration;

    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'ai-1', isComplete: true, components: [expect.objectContaining({ data: { content: 'Complete' } })] }),
    ]);
    expect(useConversationStore.getState().isStreaming).toBe(false);
  });

  it('reconciles completion when a stale placeholder is followed by no active snapshot', async () => {
    let resolveSnapshot: (value: null) => void = () => undefined;
    fetchMessagesMock.mockResolvedValue({
      items: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        questionMessageId: 'user-1', components: [], isStreaming: true, isComplete: false,
      }],
      total: 1,
      totalPages: 1,
    });
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      questionMessageId: 'user-1',
      components: [{ id: 'text-1', type: 'text', data: { content: 'Completed during recovery' } }],
      isStreaming: false, isComplete: true, createdAt: '2026-08-23T15:00:00.000Z',
    });
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    const hydration = useConversationStore.getState().fetchMessages('conv-1');
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalled());
    resolveSnapshot(null);
    await hydration;

    expect(fetchMessageMock).toHaveBeenCalledWith('conv-1', 'ai-1');
    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
    });
    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({
        id: 'ai-1', isComplete: true,
        components: [expect.objectContaining({ data: { content: 'Completed during recovery' } })],
      }),
    ]);
  });

  it('reconciles completion that occurs after the active snapshot is captured', async () => {
    fetchMessagesMock.mockResolvedValue({
      items: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isStreaming: true, isComplete: false,
      }],
      total: 1,
      totalPages: 1,
    });
    fetchActiveStreamMock.mockResolvedValue({
      conversationId: 'conv-1', messageId: 'ai-1', revision: 2,
      components: [{ id: 'text-1', type: 'text', data: { content: 'Partial' } }],
    });
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      components: [{ id: 'text-1', type: 'text', data: { content: 'Complete' } }],
      isStreaming: false, isComplete: true, createdAt: '2026-08-23T15:00:00.000Z',
    });
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    await useConversationStore.getState().fetchMessages('conv-1');

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      streamingComponents: [],
    });
    expect(useConversationStore.getState().messages[0]).toMatchObject({
      id: 'ai-1', isComplete: true,
      components: [{ data: { content: 'Complete' } }],
    });
  });

  it('keeps reconciling when completion occurs after the first canonical recheck', async () => {
    vi.useFakeTimers();
    try {
      fetchMessagesMock.mockResolvedValue({
        items: [{
          id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
          components: [], isStreaming: true, isComplete: false,
        }],
        total: 1,
        totalPages: 1,
      });
      fetchActiveStreamMock.mockResolvedValue(null);
      fetchMessageMock
        .mockResolvedValueOnce({ id: 'ai-1', isStreaming: true, isComplete: false })
        .mockResolvedValueOnce({
          id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
          components: [{ id: 'text-1', type: 'text', data: { content: 'Eventually complete' } }],
          isStreaming: false, isComplete: true, createdAt: '2026-08-23T15:00:00.000Z',
        });
      useConversationStore.setState({ currentConversationId: 'conv-1' });

      await useConversationStore.getState().fetchMessages('conv-1');
      expect(fetchMessageMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);

      expect(fetchMessageMock).toHaveBeenCalledTimes(2);
      expect(useConversationStore.getState()).toMatchObject({
        isStreaming: false,
        streamingMessageId: null,
        pendingAssistantMessageId: null,
      });
      expect(useConversationStore.getState().messages[0]).toMatchObject({
        id: 'ai-1', isComplete: true,
        components: [{ data: { content: 'Eventually complete' } }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reconciliation after a permanent canonical read failure', async () => {
    vi.useFakeTimers();
    try {
      fetchMessagesMock.mockResolvedValue({
        items: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false }],
        total: 1,
        totalPages: 1,
      });
      fetchActiveStreamMock.mockResolvedValue(null);
      fetchMessageMock.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
      useConversationStore.setState({ currentConversationId: 'conv-1' });

      await useConversationStore.getState().fetchMessages('conv-1');
      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchMessageMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps canonical reconciliation reads at 150 including the initial read', async () => {
    vi.useFakeTimers();
    try {
      fetchMessagesMock.mockResolvedValue({
        items: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false }],
        total: 1,
        totalPages: 1,
      });
      fetchActiveStreamMock.mockResolvedValue(null);
      fetchMessageMock.mockResolvedValue({ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false });
      useConversationStore.setState({ currentConversationId: 'conv-1' });

      await useConversationStore.getState().fetchMessages('conv-1');
      await vi.advanceTimersByTimeAsync(2_000 * 200);

      expect(fetchMessageMock).toHaveBeenCalledTimes(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears recovered streaming state on a matching canonical completion update', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      streamingComponents: [{ id: 'text-1', type: 'text', data: { content: 'Partial' } }],
      messages: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isStreaming: true, isComplete: false, createdAt: '2026-08-23T14:59:00.000Z',
      }],
    });

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        conversationType: 'ai',
        components: [{ id: 'text-1', type: 'text', data: { content: 'Complete' } }],
        isStreaming: false,
        isComplete: true,
        createdAt: '2026-08-23T15:00:00.000Z',
      },
    });

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
      streamingComponents: [],
    });
    expect(useConversationStore.getState().messages[0]).toMatchObject({
      isComplete: true,
      components: [{ data: { content: 'Complete' } }],
    });
  });

  it('deduplicates snapshot text from overlapping sequenced SSE chunks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      fetchMessagesMock.mockResolvedValue({
        items: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false }],
        total: 1,
        totalPages: 1,
      });
      fetchActiveStreamMock.mockResolvedValue({
        conversationId: 'conv-1', messageId: 'ai-1', revision: 1,
        components: [{ id: 'text-1', type: 'text', data: { content: 'A' } }],
      });
      useConversationStore.setState({ currentConversationId: 'conv-1' });

      await useConversationStore.getState().fetchMessages('conv-1');
      useConversationStore.getState().onStreamChunk({
        conversationId: 'conv-1', messageId: 'ai-1', revision: 1, action: 'update',
        component: { id: 'text-1', type: 'text', data: { content: 'A' } },
      });
      useConversationStore.getState().onStreamChunk({
        conversationId: 'conv-1', messageId: 'ai-1', revision: 2, action: 'update',
        component: { id: 'text-1', type: 'text', data: { content: 'B' } },
      });
      // The coalescer flushes on the next animation frame (16ms fake tick).
      await vi.advanceTimersByTimeAsync(16);

      expect(useConversationStore.getState().streamingComponents[0]?.data.content).toBe('AB');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a newer immediate artifact add that arrives before its snapshot', async () => {
    let resolveSnapshot: (value: Record<string, unknown>) => void = () => undefined;
    fetchMessagesMock.mockResolvedValue({
      items: [{ id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai', components: [], isStreaming: true, isComplete: false }],
      total: 1,
      totalPages: 1,
    });
    fetchActiveStreamMock.mockImplementation(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    useConversationStore.setState({ currentConversationId: 'conv-1' });

    const hydration = useConversationStore.getState().fetchMessages('conv-1');
    await vi.waitFor(() => expect(fetchActiveStreamMock).toHaveBeenCalled());
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1', messageId: 'ai-1', revision: 2, action: 'add',
      component: { id: 'artifact-1', type: 'artifact', data: { artifactId: 'safe-artifact', filename: 'report.pdf', availability: 'ready' } },
    });
    resolveSnapshot({
      conversationId: 'conv-1', messageId: 'ai-1', revision: 1,
      components: [{ id: 'text-1', type: 'text', data: { content: 'Partial' } }],
    });
    await hydration;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'text-1' }),
      expect.objectContaining({ id: 'artifact-1', type: 'artifact' }),
    ]);
  });

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
      streamingComponents: [{ id: 'live-tool', type: 'toolActivity', data: { title: 'search', status: 'running' } }],
      messages: [{
        id: 'ai-1',
        conversationId: 'conv-1',
        conversationType: 'ai',
        components: [
          { id: 'tool-1', type: 'toolActivity', data: { title: 'search', status: 'completed', startedAt: '2026-07-29T08:00:00.000Z' } },
          { id: 'tool-2', type: 'toolActivity', data: { title: 'read', status: 'completed', startedAt: '2026-07-29T08:00:04.000Z' } },
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

  it('uses canonical completion components instead of live-only extras', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-edited',
      pendingAssistantMessageId: 'ai-edited',
      streamingComponents: [
        { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', summary: 'Find contract clauses', renderKind: 'search', status: 'completed' } },
        { id: 'text-1', type: 'text', data: { content: 'The contract term is 42 months [1].' } },
        { id: 'citation-1', type: 'citation', data: { parentId: 'text-1', reference: '[1]', fileName: 'contract.pdf', page: '3' } },
      ],
      messages: [{
        id: 'ai-edited', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isComplete: false, createdAt: '2026-08-31T18:14:58.000Z',
      }],
    });

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-edited',
      message: {
        conversationType: 'ai',
        components: [{ id: 'text-1', type: 'text', data: { content: 'The contract term is 42 months [1].' } }],
        isComplete: true,
        createdAt: '2026-08-31T18:14:58.000Z',
      },
    });

    expect(useConversationStore.getState().messages[0].components?.map((component) => component.type)).toEqual(['text']);
    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingComponents: [],
    });
  });

  it('does not consume or clear a newer stream after delayed completion recovery', async () => {
    let resolveCompletedMessage: (message: Record<string, unknown>) => void = () => undefined;
    fetchMessageMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCompletedMessage = resolve; }),
    );
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      streamingComponents: [{ id: 'text-1', type: 'text', data: { content: 'Old partial' } }],
      messages: [],
    });

    const oldCompletion = useConversationStore.getState().onStreamComplete({
      conversationId: 'conv-1',
      messageId: 'ai-1',
    });
    await vi.waitFor(() => expect(fetchMessageMock).toHaveBeenCalledWith('conv-1', 'ai-1'));

    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-2' });
    useConversationStore.getState().onStreamChunk({
      conversationId: 'conv-1',
      messageId: 'ai-2',
      action: 'add',
      component: { id: 'tool-2', type: 'toolActivity', data: { toolName: 'search', status: 'running' } },
    });
    resolveCompletedMessage({
      id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
      components: [{ id: 'text-1', type: 'text', data: { content: 'Old complete' } }],
      isComplete: true, createdAt: '2026-08-31T18:14:58.000Z',
    });
    await oldCompletion;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-2',
      pendingAssistantMessageId: 'ai-2',
    });
    expect(useConversationStore.getState().streamingComponents).toEqual([
      expect.objectContaining({ id: 'tool-2' }),
    ]);
    expect(useConversationStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'ai-1', isComplete: true }),
    ]);
  });

  it('ignores a delayed error from an older message while a newer stream is active', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-2',
      pendingAssistantMessageId: 'ai-2',
      streamingComponents: [{ id: 'text-2', type: 'text', data: { content: 'New partial' } }],
    });

    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1404',
      message: 'Old stream failed',
    });

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-2',
      pendingAssistantMessageId: 'ai-2',
      streamingComponents: [{ id: 'text-2', type: 'text', data: { content: 'New partial' } }],
    });
  });

  it('handles a scoped error after its canonical completion cleared stream ownership', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      messages: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isComplete: false, createdAt: '2026-08-31T18:14:58.000Z',
      }],
    });

    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        components: [{ id: 'error-1', type: 'error', data: { code: 'ERR_1417', message: 'Limit reached' } }],
        isComplete: true,
      },
    });
    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1417',
      message: 'Limit reached',
    });

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: false,
      streamingMessageId: null,
      pendingAssistantMessageId: null,
      pendingTerminalErrorKey: null,
      inputDisabled: true,
      criticalError: { code: 'ERR_1417' },
    });
  });

  it('preserves foreground terminal error ownership across a background stream start', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      messages: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isComplete: false, createdAt: '2026-08-31T18:14:58.000Z',
      }],
    });
    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        components: [{ id: 'error-1', type: 'error', data: { code: 'ERR_1417', message: 'Limit reached' } }],
        isComplete: true,
      },
    });

    useConversationStore.getState().onStreamStart({ conversationId: 'conv-2', messageId: 'ai-2' });
    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1417',
      message: 'Limit reached',
    });

    expect(useConversationStore.getState()).toMatchObject({
      pendingTerminalErrorKey: null,
      inputDisabled: true,
      criticalError: { code: 'ERR_1417' },
    });
    expect(useConversationStore.getState().streamingStateCache.get('conv-2')).toMatchObject({
      streamingMessageId: 'ai-2',
    });
  });

  it('does not apply a completed old error after a newer stream starts', () => {
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
      messages: [{
        id: 'ai-1', conversationId: 'conv-1', conversationType: 'ai',
        components: [], isComplete: false, createdAt: '2026-08-31T18:14:58.000Z',
      }],
    });
    useConversationStore.getState().onMessageUpdated({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      message: {
        components: [{ id: 'error-1', type: 'error', data: { code: 'ERR_1417', message: 'Limit reached' } }],
        isComplete: true,
      },
    });

    useConversationStore.getState().onStreamStart({ conversationId: 'conv-1', messageId: 'ai-2' });
    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1417',
      message: 'Limit reached',
    });

    expect(useConversationStore.getState()).toMatchObject({
      isStreaming: true,
      streamingMessageId: 'ai-2',
      pendingAssistantMessageId: 'ai-2',
      pendingTerminalErrorKey: null,
      inputDisabled: false,
      criticalError: null,
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

  it('retains scoped error ownership after reconciliation finds an error completion', async () => {
    fetchMessageMock.mockResolvedValue({
      id: 'ai-1',
      conversationId: 'conv-1',
      conversationType: 'ai',
      components: [{ id: 'error-1', type: 'error', data: { code: 'ERR_1417', message: 'Limit reached' } }],
      isComplete: true,
      createdAt: '2026-08-31T18:14:58.000Z',
    });
    useConversationStore.setState({
      currentConversationId: 'conv-1',
      isStreaming: true,
      streamingConversationId: 'conv-1',
      streamingMessageId: 'ai-1',
      pendingAssistantMessageId: 'ai-1',
    });

    await useConversationStore.getState().reconcilePendingStream();
    expect(useConversationStore.getState().pendingTerminalErrorKey).toBe('conv-1:ai-1');
    useConversationStore.getState().onStreamError({
      conversationId: 'conv-1',
      messageId: 'ai-1',
      errorCode: 'ERR_1417',
      message: 'Limit reached',
    });

    expect(useConversationStore.getState()).toMatchObject({
      pendingTerminalErrorKey: null,
      inputDisabled: true,
      criticalError: { code: 'ERR_1417' },
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
        components: [{ id: 'tool-1', type: 'toolActivity', data: { title: 'search', status: 'completed' } }],
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
        components: [expect.objectContaining({ type: 'toolActivity' })],
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

  it('merges tool metadata while retaining bounded results', () => {
    const components = applyChunksToComponents([], [
      {
        action: 'add',
        component: {
          id: 'tool-call-1',
          type: 'toolActivity',
          data: { toolName: 'search_documents', status: 'running', paramsJson: '{"query":"contract"}', startedAt: '2026-07-21T10:13:42Z' },
        },
      },
      {
        action: 'update',
        component: {
          id: 'tool-call-1',
          type: 'toolActivity',
          data: { toolName: 'search_documents', status: 'completed', paramsJson: '', resultJson: '{"matches":2}' },
        },
      },
    ] as never);

    expect(components).toEqual([
      {
        id: 'tool-call-1',
        type: 'toolActivity',
        data: {
          toolName: 'search_documents',
          status: 'completed',
          paramsJson: '{"query":"contract"}',
          startedAt: '2026-07-21T10:13:42Z',
          resultJson: '{"matches":2}',
        },
      },
    ]);
  });

  it('inserts a missing space between streamed sentences', () => {
    const components = applyChunksToComponents([], [
      { action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'The index does not reference it.' } } },
      { action: 'update', component: { id: 'text-1', type: 'text', data: { content: 'The libraries are available.' } } },
    ] as never);

    expect(components[0].data.content).toBe('The index does not reference it. The libraries are available.');
  });

  it.each([
    ['3.', '14', '3.14'],
    ['v2.', '1', 'v2.1'],
    ['word', ' continuation', 'word continuation'],
  ])('does not alter ordinary token boundaries: %s + %s', (existing, incoming, expected) => {
    const components = applyChunksToComponents([], [
      { action: 'add', component: { id: 'text-1', type: 'text', data: { content: existing } } },
      { action: 'update', component: { id: 'text-1', type: 'text', data: { content: incoming } } },
    ] as never);

    expect(components[0].data.content).toBe(expected);
  });

  it('upserts out-of-order tools without collapsing repeated names or regressing status', () => {
    const components = applyChunksToComponents([], [
      { action: 'update', component: { id: 'tool-agent-call-1', type: 'toolActivity', data: { toolName: 'search', status: 'completed', resultJson: '{"matches":1}' } } },
      { action: 'add', component: { id: 'tool-agent-call-1', type: 'toolActivity', data: { toolName: 'search', status: 'running', paramsJson: '{"q":"one"}' } } },
      { action: 'add', component: { id: 'tool-agent-call-2', type: 'toolActivity', data: { toolName: 'search', status: 'running', paramsJson: '{"q":"two"}' } } },
      { action: 'add', component: { id: 'tool-agent-call-2', type: 'toolActivity', data: { toolName: 'search', status: 'running', paramsJson: '{"q":"two"}' } } },
    ] as never);

    expect(components).toHaveLength(2);
    expect(components[0].data).toMatchObject({ status: 'completed', paramsJson: '{"q":"one"}', resultJson: '{"matches":1}' });
    expect(components[1].data).toMatchObject({ status: 'running', paramsJson: '{"q":"two"}' });
  });
});
