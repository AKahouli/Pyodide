import { StreamService } from './stream.service';
import type { MessageComponent } from '../interfaces/message.interface';

describe('StreamService guardrail metadata buffering', () => {
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
        { id: 'activity-1', type: 'agentActivity', data: { summary: 'Planning' } },
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
});
