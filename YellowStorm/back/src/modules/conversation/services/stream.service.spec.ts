import { StreamService } from './stream.service';
import type { MessageComponent } from '../interfaces/message.interface';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { EventEmitter } from 'events';

describe('StreamService guardrail metadata buffering', () => {
  const createLifecycleHarness = (completeAIMessage: jest.Mock) => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const releaseStreamExecution = jest.fn().mockResolvedValue(undefined);
    const claimStreamExecution = jest.fn().mockResolvedValue(true);
    const recordUsage = jest.fn().mockResolvedValue(undefined);
    const broadcastToConversation = jest.fn().mockResolvedValue(undefined);
    const sendToUser = jest.fn();
    const markStreamFailed = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      isGrpcAvailable: true,
      chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
      activeCalls: new Map(),
      activeStreams: new Map(),
      componentBuffers: new Map(),
      streamRevisions: new Map(),
      streamUsage: new Map(),
      streamExecutionLeases: new Map(),
      streamTerminalCoordinators: new Map(),
      configService: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
      messageService: {
        claimStreamExecution,
        renewStreamExecution: jest.fn().mockResolvedValue(true),
        releaseStreamExecution,
        completeAIMessage,
        markStreamFailed,
      },
      usageService: { recordUsage },
      responseReliabilityService: { schedule: jest.fn().mockResolvedValue(undefined) },
      streamGateway: { broadcastToConversation, sendToUser },
      logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      resolveMemberIds: jest.fn().mockResolvedValue(['user-1']),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunAgentTeam', payload: {} }),
      conversationSettings: { isLatencyInstrumentationEnabled: jest.fn().mockResolvedValue(true), shouldRedactSensitiveText: jest.fn(() => false) },
    });
    return {
      service, call, releaseStreamExecution, claimStreamExecution, recordUsage,
      broadcastToConversation, sendToUser, markStreamFailed,
    };
  };

  it('returns a sanitized process-local snapshot for an active conversation stream', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      componentBuffers: new Map([['user-1:conversation-1:message-1', new Map([
        ['activity-1', { id: 'activity-1', type: 'agentActivity', data: { summary: 'Planning', detail: 'private trace' } }],
        ['artifact-1', { id: 'artifact-1', type: 'artifact', data: { filename: 'report.pdf', storagePath: '/workspace/private/report.pdf' } }],
      ])]]),
      streamRevisions: new Map([['user-1:conversation-1:message-1', 7]]),
    });

    expect(service.getActiveStreamSnapshot('conversation-1')).toEqual({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      revision: 7,
      components: [
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Planning', detail: 'private trace' } },
        { id: 'artifact-1', type: 'artifact', data: { filename: 'report.pdf' } },
      ],
    });
    expect(service.getActiveStreamSnapshot('conversation-2')).toBeNull();
  });

  it('revisions terminal tool updates before broadcasting them', async () => {
    const broadcastToConversation = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(StreamService.prototype) as StreamService;
    const streamKey = 'user-1:conversation-1:message-1';
    const buffer = new Map<string, MessageComponent>([['tool-1', {
      id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running' },
    }]]);
    Object.assign(service as object, {
      streamRevisions: new Map([[streamKey, 4]]),
      streamGateway: { broadcastToConversation },
    });

    await (service as any).finalizeRunningTools(
      buffer,
      'failed',
      'conversation-1',
      ['user-1'],
      { streamKey, messageId: 'message-1' },
    );

    expect(broadcastToConversation).toHaveBeenCalledWith(['user-1'], {
      type: 'stream_chunk',
      data: expect.objectContaining({
        conversationId: 'conversation-1', messageId: 'message-1', revision: 5, action: 'update',
        component: expect.objectContaining({ id: 'tool-1', data: expect.objectContaining({ status: 'failed' }) }),
      }),
    });
  });

  it('persists terminal tool state when its broadcast fails', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>([['tool-1', {
      id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running' },
    }]]);
    Object.assign(service as object, {
      streamRevisions: new Map([['user-1:conversation-1:message-1', 1]]),
      streamGateway: { broadcastToConversation: jest.fn().mockRejectedValue(new Error('disconnected')) },
      logger: { error: jest.fn() },
    });

    await expect((service as any).finalizeRunningTools(
      buffer,
      'failed',
      'conversation-1',
      ['user-1'],
      { streamKey: 'user-1:conversation-1:message-1', messageId: 'message-1' },
    )).resolves.toBeUndefined();
    expect(buffer.get('tool-1')?.data.status).toBe('failed');
  });

  it('terminalizes running tools before persisting active buffers on shutdown', async () => {
    const completeAIMessage = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      activeCalls: new Map(),
      activeStreams: new Map(),
      componentBuffers: new Map([['user-1:conversation-1:message-1', new Map([['tool-1', {
        id: 'tool-1', type: 'toolActivity', data: {
          toolName: 'run_code', status: 'running', startedAt: new Date(Date.now() - 100).toISOString(),
        },
      }]])]]),
      streamRevisions: new Map(),
      chatbotClient: null,
      messageService: { completeAIMessage },
      logger: { error: jest.fn() },
    });

    await service.onModuleDestroy();

    expect(completeAIMessage).toHaveBeenCalledWith({
      messageId: 'message-1',
      components: [expect.objectContaining({ data: expect.objectContaining({ status: 'stopped', completedAt: expect.any(String), durationMs: expect.any(Number) }) })],
    });
  });

  it('uses the user-visible original name for current attached documents', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      workspaceDocumentService: {
        findByIds: jest.fn().mockResolvedValue([{
          id: 'file-1',
          filename: 'stored-name-42.txt',
          originalName: 'deatils.txt',
          mimeType: 'text/plain',
          path: 'owner/conversation-1/deatils.txt',
          workspaceId: 'workspace-1',
          createdAt: '2026-08-23T08:50:00.000Z',
        }]),
      },
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    const files = await (service as any).buildAttachedFiles(['file-1']);

    expect(files[0].document.filename).toBe('deatils.txt');
    expect(files[0].document.filepath).toBe('owner/conversation-1/deatils.txt');
  });

  it('injects per-agent run-code descriptors only into assigned agents', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      runCodeSourceScopeService: {
        buildSources: jest.fn(async (workspaceIds: string[]) => workspaceIds.map((workspaceId) => ({
          workspaceId,
          alias: workspaceId,
          cephPrefix: `owner/${workspaceId}`,
          scope: { kind: 'workspace' },
        }))),
      },
      workspaceShareService: {
        assertUserHasAccess: jest.fn().mockResolvedValue(undefined),
      },
    });
    const agents = [
      {
        id: 'agent-1', tools: [{ name: 'run_code' }], agent_params: { params: {} },
        brain_context: [{ workspace_id: 'private-1' }],
      },
      {
        id: 'agent-2', tools: [{ name: 'calculator' }], agent_params: { params: {} }, brain_context: [],
      },
    ];

    await (service as any).attachRunCodeContexts(
      agents, 'user-1', 'conversation-1', ['workspace-1', 'workspace-1'],
    );

    const assignedParams = agents[0]!.agent_params.params as Record<string, string>;
    const unassignedParams = agents[1]!.agent_params.params as Record<string, string>;
    expect(JSON.parse(assignedParams.run_code_context_json!)).toEqual({
      userId: 'user-1',
      runId: 'conversation-1',
      sources: [
        { workspaceId: 'workspace-1', alias: 'workspace-1', cephPrefix: 'owner/workspace-1', scope: { kind: 'workspace' } },
        { workspaceId: 'private-1', alias: 'private-1', cephPrefix: 'owner/private-1', scope: { kind: 'workspace' } },
      ],
    });
    expect(unassignedParams.run_code_context_json).toBeUndefined();
  });

  it('rejects attachment-derived run-code mounts when workspace access is denied', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buildSources = jest.fn();
    Object.assign(service as object, {
      runCodeSourceScopeService: { buildSources },
      workspaceShareService: {
        assertUserHasAccess: jest.fn().mockRejectedValue(new Error('forbidden')),
      },
    });
    const agents = [{
      id: 'agent-1', tools: [{ name: 'run_code' }], agent_params: { params: {} }, brain_context: [],
    }];

    await expect((service as any).attachRunCodeContexts(
      agents,
      'user-1',
      'conversation-1',
      ['trusted-workspace'],
       [{ workspaceId: 'foreign-workspace', path: 'owner/private/file.pdf' }],
    )).rejects.toThrow('forbidden');
    expect(buildSources).not.toHaveBeenCalled();
  });

  it('does not union private brain workspaces across run-code agents', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      workspaceShareService: { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) },
      runCodeSourceScopeService: {
        buildSources: jest.fn(async (ids: string[]) => ids.map((workspaceId) => ({
          workspaceId, alias: workspaceId, cephPrefix: `owner/${workspaceId}`, scope: { kind: 'workspace' },
        }))),
      },
    });
    const agents = [
      { id: 'agent-a', tools: [{ name: 'run_code' }], brain_context: [{ workspace_id: 'private-a' }], agent_params: { params: {} } },
      { id: 'agent-b', tools: [{ name: 'run_code' }], brain_context: [{ workspace_id: 'private-b' }], agent_params: { params: {} } },
    ];
    await (service as any).attachRunCodeContexts(agents, 'user-1', 'message-1', ['shared'], []);
    const contextA = JSON.parse((agents[0].agent_params.params as Record<string, string>).run_code_context_json!);
    const contextB = JSON.parse((agents[1].agent_params.params as Record<string, string>).run_code_context_json!);
    expect(contextA.sources.map((source: { workspaceId: string }) => source.workspaceId)).toEqual(['shared', 'private-a']);
    expect(contextB.sources.map((source: { workspaceId: string }) => source.workspaceId)).toEqual(['shared', 'private-b']);
  });

  it('injects run-code context for WhatsApp and Telegram single-agent execution', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const agent = {
      id: 'agent-1', name: 'Agent', tools: [{ name: 'run_code' }],
      agent_params: { params: {} }, brain_context: [{ workspace_id: 'brain-1' }],
      chatbot: { model: 'model-1' },
    };
    const attachRunCodeContexts = jest.fn().mockResolvedValue(undefined);
    const executeSingleAgentGrpcStream = jest.fn().mockResolvedValue({
      durationMs: 1, componentCount: 0, chunkCount: 0,
    });
    Object.assign(service as object, {
      isGrpcAvailable: true,
      modelsService: {
        getDefaultModel: jest.fn().mockResolvedValue({}),
        getModelIdentifier: jest.fn().mockReturnValue('model-1'),
      },
      agentService: { buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([agent]) },
      resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined),
      conversationService: {
        getConversationDocument: jest.fn().mockResolvedValue({ systemWorkspaceId: 'system-1' }),
      },
      buildWorkspaceContexts: jest.fn().mockResolvedValue([{ workspace_id: 'workspace-1' }]),
      buildPreviousAttachedFiles: jest.fn().mockResolvedValue([{ workspace_id: 'system-1' }]),
      attachRunCodeContexts,
      executeSingleAgentGrpcStream,
      configService: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
      logger: { log: jest.fn() },
    });

    await service.runSingleAgentStream({
      userId: 'user-1', username: 'User', conversationId: 'conversation-1',
      messageId: 'message-1', agentId: 'agent-1', query: 'hello',
    });

    expect(attachRunCodeContexts).toHaveBeenCalledWith(
      [agent],
      'user-1',
      'message-1',
      ['workspace-1'],
      [],
    );
    expect(executeSingleAgentGrpcStream).toHaveBeenCalled();
  });

  it('does not create a gRPC call when the durable lease was lost during request preparation', async () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const executeGrpcStream = jest.fn();
    const releaseStreamExecution = jest.fn().mockResolvedValue(undefined);
    Object.assign(service as object, {
      isGrpcAvailable: true,
      activeStreams: new Map(),
      activeCalls: new Map(),
      componentBuffers: new Map(),
      streamRevisions: new Map(),
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
      conversationSettings: { isLatencyInstrumentationEnabled: jest.fn().mockResolvedValue(true), shouldRedactSensitiveText: jest.fn(() => false) },
      executeGrpcStream,
    });

    await expect(service.startStream(
      'user-1', 'conversation-1', '507f1f77bcf86cd799439011', {
        content: 'hello', playbookHandoffId: 'handoff-1',
      }, 'request-1',
    )).rejects.toThrow('lease was lost');

    expect((service as any).buildAgentExecutionRequest).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      expect.objectContaining({ playbookHandoffId: 'handoff-1' }),
      undefined,
      undefined,
      expect.objectContaining({ requestId: 'request-1' }),
      'conversation-1',
      '507f1f77bcf86cd799439011',
    );
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
      type: 'toolActivity',
       data: { toolName: 'search_documents', status: 'running', paramsJson: '{"query":"contract"}', startedAt: '2026-07-21T10:13:42Z' },
    });
    (service as any).applyChunkToBuffer(buffer, 'update', {
      id: 'tool-call-1',
      type: 'toolActivity',
       data: { toolName: 'search_documents', status: 'completed', resultJson: '{"matches":2}' },
    });

    expect(buffer.get('tool-call-1')?.data).toMatchObject({
      toolName: 'search_documents',
      status: 'completed',
      paramsJson: '{"query":"contract"}',
      startedAt: '2026-07-21T10:13:42Z',
      resultJson: '{"matches":2}',
    });
  });

  it('retains bounded tool results in conversation stream buffers', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'tool-call-public', type: 'toolActivity',
       data: { toolName: 'connector', status: 'completed', resultJson: '{"secret":"value"}' },
    });

    expect(buffer.get('tool-call-public')?.data).toMatchObject({
      toolName: 'connector',
      status: 'completed',
      resultJson: '{"secret":"value"}',
    });
  });

  it('upserts tool occurrences and never regresses a terminal status', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();
    const apply = (action: string, id: string, data: Record<string, unknown>) => (service as any).applyChunkToBuffer(buffer, action, {
      id, type: 'toolActivity', data,
    });

    apply('update', 'tool-agent-call-1', { toolName: 'search', status: 'completed', resultJson: '{"matches":1}' });
    apply('add', 'tool-agent-call-1', { toolName: 'search', status: 'running', paramsJson: '{"q":"one"}' });
    apply('add', 'tool-agent-call-2', { toolName: 'search', status: 'running', paramsJson: '{"q":"two"}' });

    expect(buffer.size).toBe(2);
    expect(buffer.get('tool-agent-call-1')?.data).toMatchObject({ status: 'completed', paramsJson: '{"q":"one"}', resultJson: '{"matches":1}' });
    expect(buffer.get('tool-agent-call-2')?.data).toMatchObject({ status: 'running', paramsJson: '{"q":"two"}' });
  });

  it('persists every buffered component before successful completion', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const completeAIMessage = jest.fn().mockResolvedValue(undefined);
    const streamKey = 'user-1:conversation-1:message-1';
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
      activeCalls: new Map(),
      activeStreams: new Map([['user-1', new Set(['conversation-1'])]]),
      componentBuffers: new Map([[streamKey, new Map()]]),
      streamRevisions: new Map([[streamKey, 0]]),
      streamUsage: new Map([[streamKey, { inputTokens: 0, outputTokens: 0, model: '' }]]),
      streamExecutionLeases: new Map([[streamKey, 'lease-1']]),
      streamTerminalCoordinators: new Map(),
      configService: { get: jest.fn() },
      messageService: { completeAIMessage },
      usageService: { recordUsage: jest.fn().mockResolvedValue(undefined) },
      responseReliabilityService: { schedule: jest.fn().mockResolvedValue(undefined) },
      streamGateway: { broadcastToConversation: jest.fn().mockResolvedValue(undefined) },
      logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    });

    const execution = (service as any).executeGrpcStream(
      'user-1', 'conversation-1', 'message-1', streamKey, {}, 10_000, ['user-1'],
    );
    call.emit('data', { action: 'add', component: { id: 'text-1', type: 'text', data: { content: 'Answer [1]' } } });
    call.emit('data', { action: 'add', component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'completed' } } });
    call.emit('data', { action: 'add', component: { id: 'citation-1', type: 'citation', data: { reference: '[1]' } } });
    call.emit('data', { action: 'add', component: { id: 'activity-1', type: 'agentActivity', data: { summary: 'Researching' } } });
    call.emit('end');
    await execution;

    expect(completeAIMessage).toHaveBeenCalledTimes(1);
    expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      streamExecutionLeaseId: 'lease-1',
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'text-1', type: 'text' }),
        expect.objectContaining({ id: 'tool-1', type: 'toolActivity' }),
        expect.objectContaining({ id: 'citation-1', type: 'citation' }),
        expect.objectContaining({ id: 'activity-1', type: 'agentActivity' }),
      ]),
    }));
  });

  it('awaits one error persistence attempt when error and end race', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    let finishPersistence: () => void = () => undefined;
    const completeAIMessage = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { finishPersistence = resolve; }),
    );
    const streamKey = 'user-1:conversation-1:message-1';
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
      activeCalls: new Map(),
      activeStreams: new Map([['user-1', new Set(['conversation-1'])]]),
      componentBuffers: new Map([[streamKey, new Map()]]),
      streamRevisions: new Map([[streamKey, 0]]),
      streamUsage: new Map([[streamKey, { inputTokens: 0, outputTokens: 0, model: '' }]]),
      streamExecutionLeases: new Map([[streamKey, 'lease-1']]),
      streamTerminalCoordinators: new Map(),
      configService: { get: jest.fn() },
      messageService: { completeAIMessage },
      usageService: { recordUsage: jest.fn().mockResolvedValue(undefined) },
      streamGateway: { broadcastToConversation: jest.fn().mockResolvedValue(undefined) },
      logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      resolveMemberIds: jest.fn().mockResolvedValue(['user-1']),
    });

    const execution = (service as any).executeGrpcStream(
      'user-1', 'conversation-1', 'message-1', streamKey, {}, 10_000, ['user-1'],
    ) as Promise<void>;
    let settled = false;
    void execution.catch(() => { settled = true; });
    call.emit('data', { action: 'add', component: { id: 'tool-1', type: 'toolActivity', data: { toolName: 'search', status: 'running' } } });
    call.emit('error', Object.assign(new Error('runtime failed'), { code: 13 }));
    call.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    expect(completeAIMessage).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
      streamExecutionLeaseId: 'lease-1',
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'tool-1', data: expect.objectContaining({ status: 'failed' }) }),
        expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: ErrorCode.CHAT_STREAM_FAILED }) }),
      ]),
    }));

    finishPersistence();
    await expect(execution).rejects.toThrow('runtime failed');
    expect(completeAIMessage).toHaveBeenCalledTimes(1);
  });

  it('awaits partial persistence before rejecting an idle timeout', async () => {
    jest.useFakeTimers();
    try {
      const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
      let finishPersistence: () => void = () => undefined;
      const completeAIMessage = jest.fn().mockImplementation(
        () => new Promise<void>((resolve) => { finishPersistence = resolve; }),
      );
      const streamKey = 'user-1:conversation-1:message-1';
      const service = Object.create(StreamService.prototype) as StreamService;
      Object.assign(service as object, {
        chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
        activeCalls: new Map(),
        activeStreams: new Map([['user-1', new Set(['conversation-1'])]]),
        componentBuffers: new Map([[streamKey, new Map([['text-1', {
          id: 'text-1', type: 'text', data: { content: 'Partial answer' },
        }]])]]),
        streamRevisions: new Map([[streamKey, 0]]),
        streamUsage: new Map([[streamKey, { inputTokens: 0, outputTokens: 0, model: '' }]]),
        streamExecutionLeases: new Map([[streamKey, 'lease-1']]),
        streamTerminalCoordinators: new Map(),
        configService: { get: jest.fn() },
        messageService: { completeAIMessage },
        usageService: { recordUsage: jest.fn().mockResolvedValue(undefined) },
        streamGateway: { broadcastToConversation: jest.fn().mockResolvedValue(undefined) },
        logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
        resolveMemberIds: jest.fn().mockResolvedValue(['user-1']),
      });

      const execution = (service as any).executeGrpcStream(
        'user-1', 'conversation-1', 'message-1', streamKey, {}, 10, ['user-1'],
      ) as Promise<void>;
      let settled = false;
      void execution.catch(() => { settled = true; });
      await jest.advanceTimersByTimeAsync(10);

      expect(call.cancel).toHaveBeenCalledTimes(1);
      expect(completeAIMessage).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({ id: 'text-1' }),
          expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: ErrorCode.CHAT_STREAM_TIMEOUT }) }),
        ]),
      }));

      finishPersistence();
      await expect(execution).rejects.toThrow('Stream idle timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses heartbeat chunks only to reset the idle timeout', async () => {
    jest.useFakeTimers();
    try {
      const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
      const completeAIMessage = jest.fn().mockResolvedValue(undefined);
      const broadcastToConversation = jest.fn().mockResolvedValue(undefined);
      const streamKey = 'user-1:conversation-1:message-1';
      const service = Object.create(StreamService.prototype) as StreamService;
      Object.assign(service as object, {
        chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
        activeCalls: new Map(),
        activeStreams: new Map([['user-1', new Set(['conversation-1'])]]),
        componentBuffers: new Map([[streamKey, new Map()]]),
        streamRevisions: new Map([[streamKey, 0]]),
        streamUsage: new Map([[streamKey, { inputTokens: 0, outputTokens: 0, model: '' }]]),
        streamExecutionLeases: new Map([[streamKey, 'lease-1']]),
        streamTerminalCoordinators: new Map(),
        configService: { get: jest.fn() },
        messageService: { completeAIMessage },
        usageService: { recordUsage: jest.fn().mockResolvedValue(undefined) },
        responseReliabilityService: { schedule: jest.fn().mockResolvedValue(undefined) },
        streamGateway: { broadcastToConversation },
        logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      });

      const execution = (service as any).executeGrpcStream(
        'user-1', 'conversation-1', 'message-1', streamKey, {}, 10, ['user-1'],
      ) as Promise<void>;
      await jest.advanceTimersByTimeAsync(9);
      call.emit('data', { action: 'heartbeat', metadata: { message_id: 'conversation-1' } });
      await jest.advanceTimersByTimeAsync(9);

      expect(call.cancel).not.toHaveBeenCalled();
      expect(broadcastToConversation).not.toHaveBeenCalled();
      expect(completeAIMessage).not.toHaveBeenCalled();

      call.emit('end');
      await execution;
      expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the original lease until stop persistence finishes during an end race', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    let finishPersistence: () => void = () => undefined;
    const completeAIMessage = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { finishPersistence = resolve; }),
    );
    const releaseStreamExecution = jest.fn().mockResolvedValue(undefined);
    const claimStreamExecution = jest.fn().mockResolvedValue(true);
    const service = Object.create(StreamService.prototype) as StreamService;
    Object.assign(service as object, {
      isGrpcAvailable: true,
      chatbotClient: { RunAgentTeam: jest.fn().mockReturnValue(call) },
      activeCalls: new Map(),
      activeStreams: new Map(),
      componentBuffers: new Map(),
      streamRevisions: new Map(),
      streamUsage: new Map(),
      streamExecutionLeases: new Map(),
      streamTerminalCoordinators: new Map(),
      configService: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
      messageService: {
        claimStreamExecution,
        renewStreamExecution: jest.fn().mockResolvedValue(true),
        releaseStreamExecution,
        completeAIMessage,
        markStreamFailed: jest.fn().mockResolvedValue(undefined),
      },
      usageService: { recordUsage: jest.fn().mockResolvedValue(undefined) },
      responseReliabilityService: { schedule: jest.fn().mockResolvedValue(undefined) },
      streamGateway: {
        broadcastToConversation: jest.fn().mockResolvedValue(undefined),
        sendToUser: jest.fn(),
      },
      logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
      resolveMemberIds: jest.fn().mockResolvedValue(['user-1']),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunAgentTeam', payload: {} }),
      conversationSettings: { isLatencyInstrumentationEnabled: jest.fn().mockResolvedValue(true), shouldRedactSensitiveText: jest.fn(() => false) },
    });

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    await new Promise((resolve) => setImmediate(resolve));
    call.emit('data', {
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'Partial answer' } },
    });

    const stopped = service.stopStream('user-1', 'conversation-1', 'message-1');
    call.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    const leaseId = claimStreamExecution.mock.calls[0]?.[1];
    expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      streamExecutionLeaseId: leaseId,
    }));
    expect(releaseStreamExecution).not.toHaveBeenCalled();

    finishPersistence();
    await stopped;
    await started;
    expect(releaseStreamExecution).toHaveBeenCalledWith('message-1', leaseId);
    expect(completeAIMessage).toHaveBeenCalledTimes(1);
  });

  it('makes a later stop await natural completion without duplicating terminal work', async () => {
    let finishPersistence: () => void = () => undefined;
    const completeAIMessage = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { finishPersistence = resolve; }),
    );
    const {
      service, call, releaseStreamExecution, claimStreamExecution, recordUsage,
      broadcastToConversation, sendToUser,
    } = createLifecycleHarness(completeAIMessage);

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    await new Promise((resolve) => setImmediate(resolve));
    call.emit('data', {
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'Complete answer' } },
      usage: { input_tokens: 2, output_tokens: 3, model: 'model-1' },
    });
    call.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    const stopped = service.stopStream('user-1', 'conversation-1', 'message-1');
    expect(completeAIMessage).toHaveBeenCalledTimes(1);
    expect(releaseStreamExecution).not.toHaveBeenCalled();
    expect(call.cancel).not.toHaveBeenCalled();

    finishPersistence();
    await Promise.all([started, stopped]);

    const leaseId = claimStreamExecution.mock.calls[0]?.[1];
    expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
      streamExecutionLeaseId: leaseId,
    }));
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(broadcastToConversation.mock.calls.filter(([, event]) => event.type === 'stream_complete')).toHaveLength(1);
    expect(sendToUser).not.toHaveBeenCalled();
    expect(releaseStreamExecution).toHaveBeenCalledWith('message-1', leaseId);
  });

  it('makes a later stop await natural error persistence without duplicating terminal work', async () => {
    let finishPersistence: () => void = () => undefined;
    const completeAIMessage = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { finishPersistence = resolve; }),
    );
    const {
      service, call, releaseStreamExecution, claimStreamExecution, recordUsage,
      broadcastToConversation, sendToUser, markStreamFailed,
    } = createLifecycleHarness(completeAIMessage);

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    const startedResult = started.then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));
    call.emit('data', {
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'Partial answer' } },
      usage: { input_tokens: 2, output_tokens: 1, model: 'model-1' },
    });
    const runtimeError = Object.assign(new Error('runtime failed'), { code: 13 });
    call.emit('error', runtimeError);
    await new Promise((resolve) => setImmediate(resolve));

    const stopped = service.stopStream('user-1', 'conversation-1', 'message-1');
    const stoppedResult = stopped.then(() => null, (error: unknown) => error);
    expect(completeAIMessage).toHaveBeenCalledTimes(1);
    expect(releaseStreamExecution).not.toHaveBeenCalled();

    finishPersistence();
    expect(await startedResult).toBe(runtimeError);
    expect(await stoppedResult).toBe(runtimeError);

    const leaseId = claimStreamExecution.mock.calls[0]?.[1];
    expect(completeAIMessage).toHaveBeenCalledWith(expect.objectContaining({
      streamExecutionLeaseId: leaseId,
    }));
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(broadcastToConversation.mock.calls.filter(([, event]) => event.type === 'stream_error')).toHaveLength(1);
    expect(sendToUser).not.toHaveBeenCalled();
    expect(markStreamFailed).toHaveBeenCalledTimes(1);
    expect(releaseStreamExecution).toHaveBeenCalledWith('message-1', leaseId);
  });

  it('does not report a successful stop when canonical persistence fails', async () => {
    const persistenceError = new Error('database unavailable');
    const completeAIMessage = jest.fn().mockRejectedValue(persistenceError);
    const {
      service, call, releaseStreamExecution, recordUsage, sendToUser, markStreamFailed,
    } = createLifecycleHarness(completeAIMessage);

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    const startedResult = started.then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));
    call.emit('data', {
      action: 'add',
      component: { id: 'text-1', type: 'text', data: { content: 'Partial answer' } },
      usage: { input_tokens: 2, output_tokens: 1, model: 'model-1' },
    });

    const stopped = service.stopStream('user-1', 'conversation-1', 'message-1');
    const stoppedResult = stopped.then(() => null, (error: unknown) => error);

    expect(await stoppedResult).toBe(persistenceError);
    expect(await startedResult).toBe(persistenceError);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
    expect(markStreamFailed).toHaveBeenCalledTimes(1);
    expect(releaseStreamExecution).toHaveBeenCalledTimes(1);
  });

  it('persists an empty canonical completion when stopped before the first component', async () => {
    const completeAIMessage = jest.fn().mockResolvedValue(undefined);
    const {
      service, releaseStreamExecution, claimStreamExecution, recordUsage, sendToUser, markStreamFailed,
    } = createLifecycleHarness(completeAIMessage);

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    await new Promise((resolve) => setImmediate(resolve));

    await service.stopStream('user-1', 'conversation-1', 'message-1');
    await started;

    const leaseId = claimStreamExecution.mock.calls[0]?.[1];
    expect(completeAIMessage).toHaveBeenCalledWith({
      messageId: 'message-1',
      streamExecutionLeaseId: leaseId,
      components: [],
    });
    expect(markStreamFailed).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'stream_complete',
      data: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      },
    });
    expect(releaseStreamExecution).toHaveBeenCalledWith('message-1', leaseId);
  });

  it('keeps terminal ownership until the message-scoped error event settles', async () => {
    const completeAIMessage = jest.fn().mockResolvedValue(undefined);
    const {
      service, call, releaseStreamExecution, broadcastToConversation,
    } = createLifecycleHarness(completeAIMessage);
    let finishErrorBroadcast: () => void = () => undefined;
    broadcastToConversation.mockImplementation((_members, event) => {
      if (event.type !== 'stream_error') return Promise.resolve();
      return new Promise<void>((resolve) => { finishErrorBroadcast = resolve; });
    });

    const started = service.startStream(
      'user-1', 'conversation-1', 'message-1', { content: 'question' },
    );
    const startedResult = started.then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setImmediate(resolve));
    const runtimeError = Object.assign(new Error('runtime failed'), { code: 13 });
    call.emit('error', runtimeError);
    await new Promise((resolve) => setImmediate(resolve));

    expect(broadcastToConversation).toHaveBeenCalledWith(['user-1'], {
      type: 'stream_error',
      data: expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'message-1',
        errorCode: ErrorCode.CHAT_STREAM_FAILED,
      }),
    });
    expect((service as any).activeStreams.get('user-1')).toContain('conversation-1');
    expect(releaseStreamExecution).not.toHaveBeenCalled();

    finishErrorBroadcast();
    expect(await startedResult).toBe(runtimeError);
    expect((service as any).activeStreams.has('user-1')).toBe(false);
    expect(releaseStreamExecution).toHaveBeenCalledTimes(1);
  });
});
