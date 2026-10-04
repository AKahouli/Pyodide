import { StreamService } from './stream.service';
import { ConversationAgentRequestBuilder } from './conversation-agent-request.builder';
import { newRootExecutionPolicy } from '../../agent/interfaces/root-execution-policy.interface';

describe('StreamService root enrollment', () => {
  const rootId = '111111111111111111111111';

  function harness() {
    const service = Object.create(StreamService.prototype) as StreamService;
    const policy = newRootExecutionPolicy(false);
    const agent = { id: rootId, tools: [], brain_context: [] };
    const findUserAgentById = jest.fn().mockResolvedValue({ rootExecutionPolicy: policy });
    const buildAgentsForStream = jest.fn().mockResolvedValue([agent]);
    const buildGrpcAgentsForPlaybook = jest.fn().mockResolvedValue([]);
    const resolveForActor = jest.fn().mockResolvedValue({ policy, rootSnapshotDigest: 'frozen-root', delegationEnabled: true, entries: [] });
    const registerExecution = jest.fn().mockResolvedValue({});
    const recordNativeState = jest.fn().mockResolvedValue({});
    const validateContinuation = jest.fn();
    Object.assign(service, {
      logger: { debug: jest.fn() },
      conversationService: { getConversationDocument: jest.fn().mockResolvedValue({
        rootAgentId: rootId, runtimePurpose: 'chat', isGroup: false,
        groupTaggedAgentIds: [], systemWorkspaceId: 'system-1',
      }) },
      conversationSettings: {
        getSettings: jest.fn().mockResolvedValue({ compaction: { enabled: false } }),
        isAttachmentIntelligenceEnabled: jest.fn().mockResolvedValue(false),
      },
      agentService: { findUserAgentById, buildAgentsForStream, buildGrpcAgentsForPlaybook },
      rootDelegateResolver: { resolveForActor },
      rootWorkService: { registerExecution, recordNativeState, validateContinuation },
      buildWorkspaceContexts: jest.fn().mockResolvedValue([]),
      buildAttachedFiles: jest.fn().mockResolvedValue({ attachedFiles: [], preparedDocuments: [] }),
      buildPreviousAttachedFiles: jest.fn().mockResolvedValue([]),
      buildRunCodeAttachmentSources: jest.fn().mockResolvedValue([]),
      resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined),
      attachRunCodeContexts: jest.fn().mockResolvedValue(undefined),
      agentRequestBuilder: new ConversationAgentRequestBuilder(),
    });
    const request = { content: 'hello', attachedFileIds: [], agentIds: [] as string[], skillIds: [], webSearchEnabled: false, deepSearchEnabled: false };
    const run = () => service.buildAgentExecutionRequest('user-1', 'conversation-1', request);
    return { service, policy, request, run, findUserAgentById, buildAgentsForStream, resolveForActor,
      registerExecution, recordNativeState, validateContinuation, buildGrpcAgentsForPlaybook };
  }

  it.each([true, false])('enrolls without candidate hydration when delegation enabled=%s', async (enabled) => {
    const h = harness();
    h.resolveForActor.mockResolvedValue({ policy: h.policy, delegationEnabled: enabled, entries: [] });
    const result = await h.run();
    expect(result.payload.execution_scope).toEqual(expect.objectContaining({ execution_role: 1, depth: 0 }));
    expect(result.payload.root_context).toEqual(expect.objectContaining({ catalog: [], native_input_control_version: 1,
      temporary_workers_enabled: h.policy.temporaryWorkers.enabled,
      max_temporary_workers: h.policy.temporaryWorkers.maxPerWorkGroup }));
    expect(result.payload.delegate_candidates).toBeUndefined();
    expect(h.buildAgentsForStream).toHaveBeenCalledTimes(1);
  });

  it('keeps agents without persisted enrollment in legacy mode', async () => {
    const h = harness();
    h.findUserAgentById.mockResolvedValue({ rootExecutionPolicy: null });
    const result = await h.run();
    expect(result.payload.execution_scope).toBeUndefined();
    expect(h.resolveForActor).not.toHaveBeenCalled();
  });

  it('admits a finite wire deadline and preserves the same durable deadline on resume', async () => {
    const h = harness(); const before = Date.now();
    const started = await h.run();
    const deadline = Number((started.payload.execution_scope as Record<string, unknown>).deadline_epoch_ms);
    expect(deadline).toBeGreaterThanOrEqual(before + h.policy.limits.maxWorkGroupDurationSeconds * 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + h.policy.limits.maxWorkGroupDurationSeconds * 1000);
    expect((started.payload.root_context as Record<string, unknown>).worker_permit_version).toBe(1);
    const state = h.recordNativeState.mock.calls[0][1];
    expect(state.scope.deadlineEpochMs).toBe(deadline);
    state.invocationId = 'native-invocation';
    state.pendingInputs = [{ inputId: 'pending-input', functionName: 'adk_request_input' }];
    h.validateContinuation.mockResolvedValue(state);
    h.policy.limits.maxWorkGroupDurationSeconds = 3600;
    Object.assign(h.request, { rootContinuation: { executionId: state.scope.executionId,
      inputResponses: [{ inputId: 'pending-input', response: { answer: 'yes' } }] } });
    const resumed = await h.run();
    expect(Number((resumed.payload.execution_scope as Record<string, unknown>).deadline_epoch_ms)).toBe(deadline);
  });

  it('sends metadata only and never hydrates unused specialists', async () => {
    const h = harness();
    Object.assign(h.request, { modelId: 'root-model', reasoningEffort: 'root-effort' });
    h.resolveForActor.mockResolvedValue({ policy: h.policy, rootSnapshotDigest: 'frozen-root',
      delegationEnabled: true, entries: [{ agentId: '222222222222222222222222',
        name: 'Team specialist', description: '', configurationMode: 'native', snapshotDigest: 'worker-digest' }] });
    h.buildGrpcAgentsForPlaybook.mockResolvedValue([{ id: '222222222222222222222222',
      tools: [], brain_context: [], chatbot: { model: 'worker-model' } }]);
    const result = await h.run();
    expect(h.buildAgentsForStream).toHaveBeenCalledTimes(1);
    expect(h.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
    expect(result.payload.delegate_candidates).toBeUndefined();
    expect(result.payload.root_context).toEqual(expect.objectContaining({ delegate_definition_mode: 'lazy',
      catalog: [expect.objectContaining({ agent_id: '222222222222222222222222' })] }));
  });

  it('continues the original identity and frozen inputs without repeating preparation', async () => {
    const h = harness();
    const agent = (correlation: string, credential: string) => ({ id: rootId, tools: [], brain_context: [],
      connector_bindings: [{ connector_id: 'connector', actions: [{ action_key: 'read' }],
        fixed_params: { workspace_id: 'allowed' },
        auth_headers: { 'X-Correlation-Id': correlation, Authorization: credential }, auth_env: { TOKEN: credential } }],
      agent_params: { params: { platform_api_token: credential, user_id: 'user-1',
        connector_bindings_json: JSON.stringify([{ auth_headers: { Authorization: credential } }]) } },
    });
    h.buildAgentsForStream.mockResolvedValue([agent('initial', 'initial-credential')]);
    await h.run();
    const state = h.recordNativeState.mock.calls[0][1];
    state.invocationId = 'native-invocation';
    state.pendingInputs = [{ inputId: 'pending-input', functionName: 'adk_request_input' }];
    h.validateContinuation.mockResolvedValue(state);
    h.buildAgentsForStream.mockResolvedValue([agent('new-message', 'refreshed-credential')]);
    Object.assign(h.request, { modelId: 'replacement-model', rootContinuation: {
      executionId: state.scope.executionId,
      inputResponses: [{ inputId: 'pending-input', response: { answer: 'yes' } }],
    } });
    const result = await h.run();
    expect(h.registerExecution).toHaveBeenCalledTimes(1);
    expect(h.recordNativeState).toHaveBeenCalledTimes(1);
    expect((h.service as any).buildAttachedFiles).toHaveBeenCalledTimes(1);
    expect(h.buildAgentsForStream.mock.calls[1][1]).toBeUndefined();
    expect(result.payload.execution_scope).toEqual(expect.objectContaining({
      execution_id: state.scope.executionId, native_invocation_id: 'native-invocation',
      native_session_id: 'conversation-1', resume_intent: 'resume',
    }));
    expect(result.payload.native_input_responses).toEqual([{
      input_id: 'pending-input', function_name: 'adk_request_input',
      response: { fields: { answer: { stringValue: 'yes', kind: 'stringValue' } } },
    }]);
  });

  it('denies resumed execution when a resolved definition changes', async () => {
    const h = harness();
    await h.run();
    const state = h.recordNativeState.mock.calls[0][1];
    state.invocationId = 'native-invocation';
    state.pendingInputs = [{ inputId: 'pending-input', functionName: 'adk_request_input' }];
    h.validateContinuation.mockResolvedValue(state);
    Object.assign(h.request, { rootContinuation: { executionId: state.scope.executionId,
      inputResponses: [{ inputId: 'pending-input', response: {} }] } });
    h.buildAgentsForStream.mockResolvedValue([{ id: rootId, tools: [{ name: 'new-tool' }], brain_context: [] }]);
    await expect(h.run()).rejects.toThrow('Root definition changed');
  });
  it('does not add a new invocation control to an already frozen runtime profile', async () => {
    const h = harness();
    await h.run();
    const state = h.recordNativeState.mock.calls[0][1];
    state.invocationId = 'native-invocation';
    state.rootContext.native_input_control_version = 0;
    state.pendingInputs = [{ inputId: 'pending-input', functionName: 'adk_request_input' }];
    h.validateContinuation.mockResolvedValue(state);
    Object.assign(h.request, { rootContinuation: { executionId: state.scope.executionId,
      inputResponses: [{ inputId: 'pending-input', response: {} }] } });
    await expect(h.run()).rejects.toThrow('Root definition changed');
  });

  it('does not enroll an explicit selection of the same root', async () => {
    const h = harness();
    h.request.agentIds = [rootId];
    const result = await h.run();
    expect(result.payload.execution_scope).toBeUndefined();
    expect(h.findUserAgentById).not.toHaveBeenCalled();
    expect(h.resolveForActor).not.toHaveBeenCalled();
  });

  it('rejects resolution failure instead of downgrading an enrolled root', async () => {
    const h = harness();
    const failure = new Error('resolver unavailable');
    h.resolveForActor.mockRejectedValue(failure);
    await expect(h.run()).rejects.toBe(failure);
  });

  it('fails closed when durable execution registration fails', async () => {
    const h = harness();
    const failure = new Error('store unavailable');
    h.registerExecution.mockRejectedValue(failure);
    await expect(h.run()).rejects.toBe(failure);
  });

  it('fails closed when the execution store is missing', async () => {
    const h = harness();
    Object.assign(h.service, { rootWorkService: undefined });
    await expect(h.run()).rejects.toThrow('Root execution store is unavailable');
  });
});
