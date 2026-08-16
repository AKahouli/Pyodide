import { StreamService } from './stream.service';
import type { MessageComponent } from '../interfaces/message.interface';

describe('StreamService guardrail metadata buffering', () => {
  it('does not create a gRPC call when the durable lease was lost during request preparation', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const executeGrpcStream = jest.fn();
    const releaseStreamExecution = jest.fn().mockResolvedValue(undefined);
    Object.assign(service as object, {
      isGrpcAvailable: true,
      activeStreams: new Map(),
      activeCalls: new Map(),
      componentBuffers: new Map(),
      streamUsage: new Map(),
      streamExecutionLeases: new Map(),
      configService: { get: jest.fn((key: string, fallback: unknown) => key === 'conversation.maxConcurrentStreams' ? 5 : fallback) },
      messageService: {
        claimStreamExecution: jest.fn().mockResolvedValue(true),
        renewStreamExecution: jest.fn().mockResolvedValue(false),
        releaseStreamExecution,
        markStreamFailed: jest.fn(),
      },
      logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      streamGateway: { broadcastToConversation: jest.fn().mockResolvedValue(undefined) },
      resolveMemberIds: jest.fn().mockResolvedValue(['user-1']),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executeGrpcStream,
    });

    await expect(service.startStream(
      'user-1', 'conversation-1', '507f1f77bcf86cd799439011', { content: 'hello' }, 'request-1',
    )).rejects.toThrow('lease was lost');

    expect(executeGrpcStream).not.toHaveBeenCalled();
    expect(releaseStreamExecution).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.any(String));
  });

  it('rejects both private replay lifecycle promises when grpc-js throws synchronously', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      isGrpcAvailable: true,
      configService: { get: jest.fn().mockReturnValue(undefined) },
      chatbotClient: { RunSingleAgent: jest.fn(() => { throw new Error('serialization failed'); }) },
    });

    const execution = service.executePrivateAgentRequest(
      { rpc: 'RunSingleAgent', payload: {} },
      1_000,
    );
    await expect(execution.started).rejects.toThrow('serialization failed');
    await expect(execution.result).rejects.toThrow('serialization failed');
  });

  it('preserves guardrail metadata on text update chunks', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();
    const decision = {
      phase: 'output',
      source: 'agent',
      decision: 'block',
      confidence: 0.93,
      attackType: 'system_prompt_extraction',
      target: 'system_prompt',
      reason: 'The response attempted to reveal hidden instructions.',
    };

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'text-1',
      type: 'text',
      data: { content: 'unsafe streamed text' },
    });
    (service as any).applyChunkToBuffer(buffer, 'update', {
      id: 'text-1',
      type: 'text',
      data: { content: 'Blocked by policy.' },
    }, decision);

    expect(buffer.get('text-1')?.data).toEqual({
      content: 'Blocked by policy.',
      guardrailDecision: decision,
    });
  });

  it('merges tool arguments and start time with the terminal result', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'tool-call-1',
      type: 'toolInfo',
      data: { title: 'search_documents', status: 'running', params: '{"query":"contract"}', startedAt: '2026-07-21T10:13:42Z' },
    });
    (service as any).applyChunkToBuffer(buffer, 'update', {
      id: 'tool-call-1',
      type: 'toolInfo',
      data: { title: 'search_documents', status: 'completed', resultJson: '{"matches":2}' },
    });

    expect(buffer.get('tool-call-1')?.data).toEqual({
      title: 'search_documents',
      status: 'completed',
      params: '{"query":"contract"}',
      startedAt: '2026-07-21T10:13:42Z',
      resultJson: '{"matches":2}',
    });
  });

  it('retains bounded tool results in conversation stream buffers', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'tool-call-public', type: 'toolInfo',
      data: { title: 'connector', status: 'completed', resultJson: '{"secret":"value"}' },
    });

    expect(buffer.get('tool-call-public')?.data).toEqual({
      title: 'connector',
      status: 'completed',
      resultJson: '{"secret":"value"}',
    });
  });

  it('upserts tool occurrences and never regresses a terminal status', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();
    const apply = (action: string, id: string, data: Record<string, unknown>) => (service as any).applyChunkToBuffer(buffer, action, {
      id, type: 'toolInfo', data,
    });

    apply('update', 'tool-agent-call-1', { title: 'search', status: 'completed', resultJson: '{"matches":1}' });
    apply('add', 'tool-agent-call-1', { title: 'search', status: 'running', params: '{"q":"one"}' });
    apply('add', 'tool-agent-call-2', { title: 'search', status: 'running', params: '{"q":"two"}' });

    expect(buffer.size).toBe(2);
    expect(buffer.get('tool-agent-call-1')?.data).toMatchObject({ status: 'completed', params: '{"q":"one"}', resultJson: '{"matches":1}' });
    expect(buffer.get('tool-agent-call-2')?.data).toMatchObject({ status: 'running', params: '{"q":"two"}' });
  });
});
