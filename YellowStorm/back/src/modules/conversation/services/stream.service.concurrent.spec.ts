import { StreamService } from './stream.service';
import { ErrorCode } from '../../exceptions';

describe('concurrent ROOT foreground streams', () => {
  function harness() {
    const service = Object.create(StreamService.prototype) as StreamService;
    const finishes = new Map<string, () => void>();
    const messageService = { claimStreamExecution: jest.fn().mockResolvedValue(true),
      completeAIMessage: jest.fn().mockResolvedValue({}),
      findById: jest.fn(async (id: string) => ({ id, conversationId: 'conversation', conversationType: 'ai',
        createdAt: '2026-10-10T10:00:00.000Z', questionMessageId: `question-${id}` })),
      renewStreamExecution: jest.fn().mockResolvedValue(true), releaseStreamExecution: jest.fn().mockResolvedValue(undefined),
      markStreamFailed: jest.fn().mockResolvedValue(undefined),
      findAllByConversation: jest.fn().mockResolvedValue(['a', 'b', 'c'].map((id) => ({ id,
        conversationType: 'ai', createdAt: new Date(0), updatedAt: new Date(0), isComplete: false }))) };
    Object.assign(service, {
      isGrpcAvailable: true, activeCalls: new Map(), activeStreams: new Map(), componentBuffers: new Map(),
      streamRevisions: new Map(), streamUsage: new Map(), streamExecutionLeases: new Map(),
      streamTerminalCoordinators: new Map(), bootstrapCancelRequested: new Set(), activeConversationExecutions: new Set(),
      configService: { get: (key: string, fallback: unknown) => key === 'conversation.maxConcurrentStreams' ? 2 : fallback },
      conversationService: { getConversationDocument: jest.fn().mockResolvedValue({ rootAgentId: 'root', runtimePurpose: 'chat' }) },
      agentService: { findUserAgentById: jest.fn().mockResolvedValue({ rootExecutionPolicy: {} }) },
      rootWorkService: { completeExecution: jest.fn().mockResolvedValue({}) },
      messageService, conversationSettings: { isLatencyInstrumentationEnabled: jest.fn().mockResolvedValue(false) },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      resolveMemberIds: jest.fn().mockResolvedValue(['user']),
      streamGateway: { broadcastToConversation: jest.fn().mockResolvedValue(undefined), sendToUser: jest.fn() },
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executeGrpcStream: jest.fn((_user: string, _conversation: string, messageId: string) =>
        new Promise<void>((resolve) => finishes.set(messageId, resolve))),
    });
    return { service, finishes, messageService };
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('keeps two replies active, recovers both and releases only the completed reply', async () => {
    const { service, finishes } = harness();
    const first = service.startStream('user', 'conversation', 'a', { content: 'first' });
    const second = service.startStream('user', 'conversation', 'b', { content: 'second' });
    await tick();
    expect(service.getActiveStreamSnapshots('conversation').map((item) => item.messageId)).toEqual(['a', 'b']);
    expect(service.getActiveStreamSnapshots('conversation')[0]).toMatchObject({
      createdAt: '2026-10-10T10:00:00.000Z', questionMessageId: 'question-a',
    });
    expect((service as any).streamGateway.broadcastToConversation).toHaveBeenCalledWith(['user'], {
      type: 'stream_start', data: { conversationId: 'conversation', messageId: 'a',
        createdAt: '2026-10-10T10:00:00.000Z', questionMessageId: 'question-a' },
    });
    await expect(service.startStream('user', 'conversation', 'c', { content: 'third' }))
      .rejects.toMatchObject({ code: ErrorCode.CHAT_STREAM_LIMIT });
    finishes.get('a')!(); await first;
    expect(service.getActiveStreamSnapshots('conversation').map((item) => item.messageId)).toEqual(['b']);
    expect(service.isConversationStreaming('user', 'conversation')).toBe(true);
    finishes.get('b')!(); await second;
    expect(service.isConversationStreaming('user', 'conversation')).toBe(false);
  });
  it('keeps a shared legacy session exclusive and settles the rejected placeholder', async () => {
    const { service, finishes, messageService } = harness();
    (service as any).conversationService.getConversationDocument.mockResolvedValue({ isGroup: true });
    const first = service.startStream('user', 'conversation', 'a', { content: 'first' });
    await tick();
    await expect(service.startStream('other-user', 'conversation', 'b', { content: 'second' }))
      .rejects.toMatchObject({ code: ErrorCode.CHAT_ALREADY_STREAMING });
    expect(messageService.markStreamFailed).toHaveBeenCalledWith('b', expect.any(String));
    finishes.get('a')!(); await first;
  });
  it('keeps roots without persisted enrollment on their legacy session', async () => {
    const { service, finishes } = harness();
    (service as any).agentService.findUserAgentById.mockResolvedValue({ rootExecutionPolicy: null });
    const first = service.startStream('user', 'conversation', 'a', { content: 'first' });
    await tick();
    expect((service as any).buildAgentExecutionRequest.mock.calls[0][6]).toBe('conversation');
    await expect(service.startStream('user', 'conversation', 'b', { content: 'second' }))
      .rejects.toMatchObject({ code: ErrorCode.CHAT_ALREADY_STREAMING });
    finishes.get('a')!(); await first;
  });
  it('stopping one admitted reply leaves its sibling snapshot and capacity registration intact', async () => {
    const { service, finishes } = harness();
    const first = service.startStream('user', 'conversation', 'a', { content: 'first' });
    const second = service.startStream('user', 'conversation', 'b', { content: 'second' });
    await tick();
    Object.assign(service, { streamRootExecutions: new Map([['user:conversation:a', 'root-a'], ['user:conversation:b', 'root-b']]) });
    (service as any).activeCalls.set('user:conversation:a', { cancel: jest.fn() });
    (service as any).componentBuffers.get('user:conversation:a').set('partial', { id: 'partial', type: 'text', data: { content: 'Partial answer' } });
    await service.stopStream('user', 'conversation', 'a');
    expect((service as any).rootWorkService.completeExecution).toHaveBeenCalledTimes(1);
    expect((service as any).rootWorkService.completeExecution).toHaveBeenCalledWith('root-a', 'cancelled', null);
    expect((service as any).messageService.completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'a', terminalStatus: 'cancelled',
      components: [{ id: 'partial', type: 'text', data: { content: 'Partial answer' } }] }));
    expect(service.getActiveStreamSnapshots('conversation').map((item) => item.messageId)).toEqual(['b']);
    expect(service.isConversationStreaming('user', 'conversation')).toBe(true);
    finishes.get('a')!(); finishes.get('b')!(); await Promise.all([first, second]);
  });
  it('logs a failed ROOT cancellation rather than reporting success', async () => {
    const { service, finishes, messageService } = harness();
    const first = service.startStream('user', 'conversation', 'a', { content: 'first' });
    await tick();
    const internals = service as any;
    internals.activeCalls.set('user:conversation:a', { cancel: jest.fn() });
    internals.streamRootExecutions = new Map([['user:conversation:a', 'root-a']]);
    internals.componentBuffers.get('user:conversation:a').set('partial', { id: 'partial', type: 'text', data: { content: 'Partial answer' } });
    internals.rootWorkService.completeExecution.mockRejectedValue(new Error('cancellation store unavailable'));
    await expect(service.stopStream('user', 'conversation', 'a')).rejects.toThrow('cancellation store unavailable');
    expect(internals.logger.error).toHaveBeenCalledWith('Failed to persist buffer on stop', expect.objectContaining({ messageId: 'a' }));
    expect(messageService.completeAIMessage).not.toHaveBeenCalled();
    finishes.get('a')!(); await first;
  });
  it('isolates an explicit mention of the enrolled bound root', async () => {
    const { service, finishes } = harness();
    const first = service.startStream('user', 'conversation', 'a', { content: 'first', agentIds: ['root'] });
    const second = service.startStream('user', 'conversation', 'b', { content: 'second', agentIds: ['root'] });
    await tick();
    expect(service.getActiveStreamSnapshots('conversation')).toHaveLength(2);
    expect((service as any).buildAgentExecutionRequest.mock.calls[0][6]).toBe('turn_a');
    expect((service as any).buildAgentExecutionRequest.mock.calls[1][6]).toBe('turn_b');
    finishes.get('a')!(); finishes.get('b')!(); await Promise.all([first, second]);
  });
  it('accepts Stop after lease claim while conversation eligibility is still loading', async () => {
    const { service, messageService } = harness();
    let releaseEligibility!: (value: object) => void;
    (service as any).conversationService.getConversationDocument.mockImplementation(() => new Promise((resolve) => { releaseEligibility = resolve; }));
    const started = service.startStream('user', 'conversation', 'a', { content: 'first' });
    const outcome = started.catch((error) => error);
    await tick();
    await expect(service.stopStream('user', 'conversation', 'a')).resolves.toBeUndefined();
    expect(messageService.completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'a', terminalStatus: 'cancelled' }));
    releaseEligibility({ rootAgentId: 'root', runtimePurpose: 'chat' });
    expect(await outcome).toMatchObject({ code: ErrorCode.CHAT_STREAM_FAILED });
    expect((service as any).buildAgentExecutionRequest).not.toHaveBeenCalled();
    expect((service as any).executeGrpcStream).not.toHaveBeenCalled();
    expect((service as any).streamExecutionLeases.size).toBe(0);
    expect(service.isConversationStreaming('user', 'conversation')).toBe(false);
  });
});
