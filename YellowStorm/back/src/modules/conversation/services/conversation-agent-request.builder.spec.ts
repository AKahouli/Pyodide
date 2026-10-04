import {
  ConversationAgentRequestBuilder,
  scopeCandidateToRootCeiling,
  resolvedDefinitionsDigest,
  type RootDelegationContext,
} from './conversation-agent-request.builder';
import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';

describe('ConversationAgentRequestBuilder', () => {
  it('keeps the native profile digest stable across acting-user tool credential refresh', () => {
    const root = { id: 'root', tools: [{ name: 'search', accessToken: 'old' }] } as unknown as IGrpcAgent;
    const refreshed = { ...root, tools: [{ name: 'search', accessToken: 'fresh' }] };
    expect(resolvedDefinitionsDigest(refreshed, [])).toBe(resolvedDefinitionsDigest(root, []));
    refreshed.tools[0].name = 'write';
    expect(resolvedDefinitionsDigest(refreshed, [])).not.toBe(resolvedDefinitionsDigest(root, []));
  });
  const request = {
    content: 'Question', attachedFileIds: ['file-1'], webSearchEnabled: true,
    deepSearchEnabled: true, modelId: 'model-1', agentIds: ['agent-1'], skillIds: ['skill-1'],
    connectorRepo: { connectorId: 'connector-1', connectorName: 'GitHub', repoId: 'repo-1', repoName: 'repo' },
  };

  it('preserves the execution payload and routes a single resolved agent', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [{ workspace_id: 'workspace-1' }], agents: [{ id: 'agent-1' }],
      attachedFiles: [{ type: 'document' }], previousAttachedFiles: [{ _id: 'old-file' }], skills: [{ id: 'skill-1' }],
      correctionReplayContext: { originalAnswer: 'Old', findings: [], attemptNumber: 1, instructions: 'Retry' },
    });
    expect(result.rpc).toBe('RunSingleAgent');
    expect(result.payload).toEqual(expect.objectContaining({
      conversation_id: 'shadow-1', query: 'Question', deep_search_enabled: true,
      agent: { id: 'agent-1' }, skills: [{ id: 'skill-1' }],
      correction_replay_context: expect.objectContaining({ original_answer: 'Old', attempt_number: 1 }),
    }));
  });

  it('routes multiple resolved agents through the team RPC', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [], agents: [{ id: 'worker' }, { id: 'manager' }],
      attachedFiles: [], previousAttachedFiles: [], skills: [],
    });
    expect(result).toEqual(expect.objectContaining({ rpc: 'RunAgentTeam' }));
    expect(result.payload).toEqual(expect.objectContaining({ agent_mode: 'manual' }));
  });

  it('always routes an explicit team with its topology through hierarchical mode', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [], agents: [{ id: 'manager' }], attachedFiles: [], previousAttachedFiles: [], skills: [],
      teamDefinition: { teamId: 'team-1', nodes: [{ agentId: 'manager', parentAgentId: null, order: 0 }] },
    });
    expect(result.rpc).toBe('RunAgentTeam');
    expect(result.payload).toEqual(expect.objectContaining({
      agent_mode: 'hierarchical',
      team_definition: { team_id: 'team-1', nodes: [{ agent_id: 'manager', parent_agent_id: '', order: 0 }] },
    }));
  });

  it('labels client context as a non-authoritative page hint', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'conversation-1',
      request: {
        ...request,
        clientContext: {
          contextVersion: 1 as const,
          route: '/playbooks/p1',
          module: 'playbooks' as const,
          surface: 'playbook.editor',
          availableActions: ['validate'],
          hasUnsavedChanges: true,
          locale: 'en',
        },
      },
      workspaceContexts: [], agents: [{ id: 'agent-1' }], attachedFiles: [], previousAttachedFiles: [], skills: [],
    });
    expect(result.payload.query).toContain('<contextual_page_hint>');
    expect(result.payload.query).toContain('It is not an authorization source.');
    expect(result.payload.query).toContain('"hasUnsavedChanges":true');
  });
  it('omits execution_scope for legacy requests and attaches the wire shape when trusted scope is present', () => {
    const base = {
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [], agents: [{ id: 'agent-1' }], attachedFiles: [], previousAttachedFiles: [], skills: [],
    };
    const legacy = new ConversationAgentRequestBuilder().build(base);
    expect(legacy.payload.execution_scope).toBeUndefined();

    const scoped = new ConversationAgentRequestBuilder().build({
      ...base,
      executionScope: {
        role: 'root',
        executionId: 'e'.repeat(24),
        parentExecutionId: null,
        workGroupId: null,
        depth: 0,
        attempt: 1,
        conversationEpoch: 4,
        expectedFence: 'fence-1',
        resumeIntent: 'start',
        immutableSnapshotRef: null,
        nativeInvocationId: null,
        nativeSessionId: null,
        deadlineEpochMs: null,
      },
    });
    expect(scoped.payload.execution_scope).toEqual({
      execution_role: 1,
      execution_id: 'e'.repeat(24),
      parent_execution_id: '',
      work_group_id: '',
      depth: 0,
      attempt: 1,
      conversation_epoch: 4,
      expected_fence: 'fence-1',
      resume_intent: 'start',
      immutable_snapshot_ref: '',
      native_invocation_id: '',
      native_session_id: '',
      deadline_epoch_ms: null,
    });
  });
  it('scopes a root_constrained candidate to the root ceiling; empty intersection denies', () => {
    const root = {
      tools: [{ name: 'search' }, { name: 'crm_list_contacts' }],
      brain_context: [{ workspace_id: 'ws-shared' }],
      skills: [{ id: 'sk-1', name: 'S' }],
    } as unknown as IGrpcAgent;
    const candidate = {
      id: 'a1',
      tools: [{ name: 'search' }, { name: 'crm_get_contact' }, { name: 'python_interpreter' }],
      brain_context: [{ workspace_id: 'ws-shared' }, { workspace_id: 'ws-private' }],
      skills: [{ id: 'sk-1', name: 'S' }, { id: 'sk-2', name: 'T' }],
    } as unknown as IGrpcAgent;

    const scoped = scopeCandidateToRootCeiling(candidate, root);
    expect(scopeCandidateToRootCeiling({ ...candidate,
      tools: [{ name: 'search', writeScope: 'all' }],
    }, root).tools).toEqual([]);
    expect(scoped.tools.map((t) => t.name)).toEqual(['search']);
    expect(scoped.brain_context.map((b) => b.workspace_id)).toEqual(['ws-shared']);
    expect(scoped.skills?.map((sk) => sk.id)).toEqual(['sk-1']);

    // A candidate with NO overlap keeps nothing (empty = deny, not all).
    const foreign = {
      id: 'a2',
      tools: [{ name: 'python_interpreter' }],
      brain_context: [{ workspace_id: 'ws-other' }],
      skills: [{ id: 'sk-9', name: 'X' }],
    } as unknown as IGrpcAgent;
    const denied = scopeCandidateToRootCeiling(foreign, root);
    expect(denied.tools).toEqual([]);
    expect(denied.brain_context).toEqual([]);
    expect(denied.skills).toEqual([]);
  });

  it('denies connector bindings absent from the root and narrows shared actions', () => {
    const binding = { connector_id: 'crm', actions: [{ action_key: 'read' }, { action_key: 'write' }] };
    const candidate = {
      tools: [], brain_context: [], connector_bindings: [binding], connectorIds: ['crm'],
      agent_params: { params: { connector_bindings_json: JSON.stringify([binding]), model_option: 'keep' } },
    } as unknown as IGrpcAgent;
    const root = { tools: [], brain_context: [] } as unknown as IGrpcAgent;
    const denied = scopeCandidateToRootCeiling(candidate, root);
    expect(denied.connector_bindings).toEqual([]);
    expect(denied.connectorIds).toEqual([]);
    expect(JSON.parse(denied.agent_params!.params.connector_bindings_json)).toEqual([]);

    root.connector_bindings = [{ connector_id: 'crm', actions: [{ action_key: 'read' }] }];
    const scoped = scopeCandidateToRootCeiling(candidate, root);
    expect(scoped.connector_bindings).toEqual([{ ...binding, actions: [{ action_key: 'read' }], enforced_params: {} }]);
    expect(JSON.parse(scoped.agent_params!.params.connector_bindings_json)).toEqual(scoped.connector_bindings);
    expect(scoped.agent_params!.params.model_option).toBe('keep');
    root.connector_bindings = [{ connector_id: 'crm', actions: [{ action_key: 'other' }] }];
    expect(scopeCandidateToRootCeiling(candidate, root).connector_bindings).toEqual([]);
    root.connector_bindings = [{ connector_id: 'crm', actions: [{ action_key: 'read' }], fixed_params: { workspace_id: 'root-only' } }];
    expect(scopeCandidateToRootCeiling(candidate, root).connector_bindings).toEqual([]);
    expect(candidate.connector_bindings).toEqual([binding]);
  });

  it('attaches root_context and delegate_candidates when delegation is present', () => {
    const rootDelegation: RootDelegationContext = {
      scope: {
        role: 'root', executionId: 'e'.repeat(24), parentExecutionId: null, workGroupId: null,
        depth: 0, attempt: 1, conversationEpoch: 3, expectedFence: null, resumeIntent: 'start',
        immutableSnapshotRef: null, nativeInvocationId: null, nativeSessionId: null, deadlineEpochMs: null,
      },
      stopRequestId: '018f0000-0000-7000-8000-000000000000',
      rootContext: {
        root_agent_id: 'r1', policy_version: '1', max_depth: 1,
        catalog: [{ agent_id: 'a1', name: 'S', configuration_mode: 'native' }],
      },
      candidates: [{ id: 'a1', name: 'S' }],
    };
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'conv-1', request,
      workspaceContexts: [], agents: [{ id: 'root-1' }], attachedFiles: [], previousAttachedFiles: [], skills: [],
      rootDelegation,
      executionScope: rootDelegation.scope,
    });
    expect(result.rpc).toBe('RunSingleAgent');
    expect(result.payload.root_context).toEqual(rootDelegation.rootContext);
    expect(result.payload.delegate_candidates).toEqual([{ id: 'a1', name: 'S' }]);
    expect(result.payload.execution_scope).toEqual(expect.objectContaining({ execution_role: 1, conversation_epoch: 3 }));
  });
});
