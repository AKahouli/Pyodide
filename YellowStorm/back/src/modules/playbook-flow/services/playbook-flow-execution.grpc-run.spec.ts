import { toGrpcStruct } from './playbook-flow-execution.service';
import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

function structFields(value: Record<string, unknown>): Record<string, unknown> {
  return (toGrpcStruct(value) as { fields: Record<string, unknown> }).fields;
}

describe('callGrpcRun router config serialization', () => {
  it('serializes deterministic router conditions into the gRPC snapshot', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {}, {}, {
      nodes: [{
        id: 'router-1',
        kind: 'router',
        routerConfig: {
          outputLabels: ['valid', 'invalid'],
          maxIterations: 3,
          defaultLabel: 'invalid',
          conditions: [{
            label: 'valid',
            sourceNode: 'step-1',
            sourcePort: 'result',
            path: 'verdict',
            operator: 'equals',
            value: 'valid',
          }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          router_config: expect.objectContaining({
            output_labels: ['valid', 'invalid'],
            max_iterations: 3,
            default_label: 'invalid',
            conditions: [expect.objectContaining({
              label: 'valid',
              source_node: 'step-1',
              source_port: 'result',
              path: 'verdict',
              operator: 'equals',
              value: { kind: 'stringValue', stringValue: 'valid' },
            })],
          }),
        })],
      }),
    }));
  });

  it('serializes enriched agent metadata into the gRPC snapshot', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    const ownerId = { toString: () => 'owner-1' } as any;
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({
      connectorIds: [],
      connector_bindings: [],
      tools: [],
    });
    agentService.buildGrpcSkillsForPlaybook.mockResolvedValue([]);
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Research agent',
        description: 'Find and summarize',
        prompt: 'Use tools when needed.',
        agent_type: 'specialist',
        tools: [{ name: 'calculator', description: 'Math helper' }],
        agent_params: {
          params: {
            user_id: 'owner-1',
            session_id: 'exec-1',
            connector_bindings_json: '[{"connector_id":"conn-1"}]',
          },
        },
        connector_bindings: [{
          connector_id: 'conn-1',
          connector_name: 'Drive',
          actions: [{ action_key: 'search', description: 'Search Drive' }],
        }],
        brain_context: [{ workspace_id: 'brain-1', workspace_documents: [] }],
        chatbot: { model: 'gpt-4o-mini' },
      },
    ]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', ownerId, {}, {}, {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        metadata: {
          assignedAgentId: 'agent-1',
          agent_tools: [{ name: 'malicious_tool', description: 'Do not trust' }],
          agent_params: { connector_bindings_json: '[{"connector_id":"evil"}]' },
          connector_bindings: [{ connector_id: 'evil', mcp_server_url: 'http://internal' }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'owner-1' }));
    const metadata = run.mock.calls[0][0].snapshot.nodes[0].metadata;
    expect(metadata.fields).toEqual(expect.objectContaining({
      execution_mode: { kind: 'stringValue', stringValue: 'live' },
      assignedAgentId: { kind: 'stringValue', stringValue: 'agent-1' },
      agent_name: { kind: 'stringValue', stringValue: 'Research agent' },
      agent_description: { kind: 'stringValue', stringValue: 'Find and summarize' },
      agent_model: { kind: 'stringValue', stringValue: 'gpt-4o-mini' },
      agent_prompt: { kind: 'stringValue', stringValue: 'Use tools when needed.' },
      agent_type: { kind: 'stringValue', stringValue: 'specialist' },
      agent_tools: structFields({ agent_tools: [{ name: 'calculator', description: 'Math helper' }] }).agent_tools,
      agent_params: structFields({
        agent_params: {
          user_id: 'owner-1',
          session_id: 'exec-1',
          connector_bindings_json: '[{"connector_id":"conn-1"}]',
        },
      }).agent_params,
      connector_bindings: structFields({
        connector_bindings: [{
          connector_id: 'conn-1',
          connector_name: 'Drive',
          actions: [{ action_key: 'search', description: 'Search Drive' }],
        }],
      }).connector_bindings,
      brain_context: structFields({
        brain_context: [{ workspace_id: 'brain-1', workspace_documents: [] }],
      }).brain_context,
    }));
    expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
      'owner-1',
      ['agent-1'],
      undefined,
      'exec-1',
      {
        userId: 'owner-1',
        scopeType: 'playbook',
        scopeId: 'playbook:exec-1',
        laneId: 'main',
      },
    );
  });

  it('merges task-scoped connector bindings into assigned agent runtime metadata without duplicates', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };

    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Research agent',
        description: 'Find and summarize',
        prompt: 'Use tools when needed.',
        agent_type: 'specialist',
        tools: [{ name: 'calculator', description: 'Math helper' }],
        agent_params: {
          params: {
            user_id: 'owner-1',
            session_id: 'exec-1',
            connector_bindings_json: '[{"connector_id":"conn-1"}]',
          },
        },
        connector_bindings: [{
          connector_id: 'conn-1',
          connector_name: 'Drive',
          actions: [{ action_key: 'search', description: 'Search Drive' }],
        }],
        connectorIds: ['conn-1'],
        brain_context: [],
        chatbot: { model: 'gpt-4o-mini' },
      },
    ]);
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({
      connectorIds: ['conn-2'],
      connector_bindings: [{
        connector_id: 'conn-2',
        connector_name: 'GitHub',
        actions: [{ action_key: 'issues', description: 'List GitHub issues' }],
        fixed_params: { repo: 'yellowstorm' },
      }],
      tools: [{ name: 'github_issues', description: 'GitHub connector action issues' }],
      skills: [{ id: 'skill-2', name: 'Connector skill', description: 'Added via connector' }],
    });
    agentService.buildGrpcSkillsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {}, {}, {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        metadata: {
          assignedAgentId: 'agent-1',
          toolBindings: [
            {
              id: 'tb-1',
              connectorId: 'conn-2',
              actions: [{ actionKey: 'issues', isEnabled: true }],
            },
            {
              id: 'tb-2',
              connectorId: 'conn-1',
              actions: [{ actionKey: 'search', isEnabled: true }],
            },
          ],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(agentService.buildGrpcConnectorRuntimeForPlaybook).toHaveBeenCalledWith('owner-1', [expect.objectContaining({ connectorId: 'conn-2' })]);
    const mergedMetadata = run.mock.calls[0][0].snapshot.nodes[0].metadata;
    expect(mergedMetadata.fields).toEqual(expect.objectContaining({
      execution_mode: { kind: 'stringValue', stringValue: 'live' },
      assignedAgentId: { kind: 'stringValue', stringValue: 'agent-1' },
      toolBindings: structFields({
        toolBindings: [
          {
            id: 'tb-1',
            connectorId: 'conn-2',
            actions: [{ actionKey: 'issues', isEnabled: true }],
          },
          {
            id: 'tb-2',
            connectorId: 'conn-1',
            actions: [{ actionKey: 'search', isEnabled: true }],
          },
        ],
      }).toolBindings,
      agent_name: { kind: 'stringValue', stringValue: 'Research agent' },
      agent_description: { kind: 'stringValue', stringValue: 'Find and summarize' },
      agent_model: { kind: 'stringValue', stringValue: 'gpt-4o-mini' },
      agent_prompt: { kind: 'stringValue', stringValue: 'Use tools when needed.' },
      agent_type: { kind: 'stringValue', stringValue: 'specialist' },
      agent_tools: structFields({
        agent_tools: [
          { name: 'calculator', description: 'Math helper' },
          { name: 'github_issues', description: 'GitHub connector action issues' },
        ],
      }).agent_tools,
      agent_params: structFields({
        agent_params: {
          user_id: 'owner-1',
          session_id: 'exec-1',
          connector_bindings_json: JSON.stringify([
            {
              connector_id: 'conn-1',
              connector_name: 'Drive',
              actions: [{ action_key: 'search', description: 'Search Drive' }],
            },
            {
              connector_id: 'conn-2',
              connector_name: 'GitHub',
              actions: [{ action_key: 'issues', description: 'List GitHub issues' }],
              fixed_params: { repo: 'yellowstorm' },
            },
          ]),
        },
      }).agent_params,
      connector_bindings: structFields({
        connector_bindings: [
          {
            connector_id: 'conn-1',
            connector_name: 'Drive',
            actions: [{ action_key: 'search', description: 'Search Drive' }],
          },
          {
            connector_id: 'conn-2',
            connector_name: 'GitHub',
            actions: [{ action_key: 'issues', description: 'List GitHub issues' }],
            fixed_params: { repo: 'yellowstorm' },
          },
        ],
      }).connector_bindings,
      connector_ids: structFields({ connector_ids: ['conn-1', 'conn-2'] }).connector_ids,
      skills: structFields({
        skills: [
          { id: 'skill-2', name: 'Connector skill', description: 'Added via connector' },
        ],
      }).skills,
      brain_context: structFields({ brain_context: [] }).brain_context,
    }));
  });

  it('merges task-scoped skills into assigned agent runtime metadata without duplicates', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };

    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Research agent',
        description: 'Find and summarize',
        prompt: 'Use tools when needed.',
        agent_type: 'specialist',
        tools: [{ name: 'calculator', description: 'Math helper' }],
        skills: [{ id: 'skill-1', name: 'Existing skill', description: 'Already on agent' }],
        agent_params: { params: { user_id: 'owner-1', session_id: 'exec-1', connector_bindings_json: '[]' } },
        connector_bindings: [],
        connectorIds: [],
        brain_context: [],
        chatbot: { model: 'gpt-4o-mini' },
      },
    ]);
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({ connectorIds: [], connector_bindings: [], tools: [], skills: [] });
    agentService.buildGrpcSkillsForPlaybook.mockResolvedValue([
      { id: 'skill-2', name: 'Dropped skill', description: 'Added at runtime' },
    ]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {}, {}, {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        metadata: {
          assignedAgentId: 'agent-1',
          skillBindings: [
            { id: 'sb-1', skillId: 'skill-2', skillName: 'Dropped skill', isEnabled: true },
            { id: 'sb-2', skillId: 'skill-1', skillName: 'Existing skill', isEnabled: true },
          ],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(agentService.buildGrpcSkillsForPlaybook).toHaveBeenCalledWith(['skill-2']);
    const metadata = run.mock.calls[0][0].snapshot.nodes[0].metadata;
    expect(metadata.fields).toEqual(expect.objectContaining({
      skillBindings: structFields({
        skillBindings: [
          { id: 'sb-1', skillId: 'skill-2', skillName: 'Dropped skill', isEnabled: true },
          { id: 'sb-2', skillId: 'skill-1', skillName: 'Existing skill', isEnabled: true },
        ],
      }).skillBindings,
      skills: structFields({
        skills: [
          { id: 'skill-1', name: 'Existing skill', description: 'Already on agent' },
          { id: 'skill-2', name: 'Dropped skill', description: 'Added at runtime' },
        ],
      }).skills,
    }));
  });

  it('serializes the concrete inference fallback resolved for a model-less planner', async () => {
    const executionSettingsResolver = {
      resolve: jest.fn().mockResolvedValue({
        dynamicReasoningEnabled: true,
        dynamicReasoning: {
          plannerAgentId: 'planner-1',
          maxWorkNodes: 6,
          maxParallelism: 3,
          maxDepth: 1,
          maxRepairAttempts: 1,
        },
      }),
      resolvePlanner: jest.fn().mockResolvedValue({
        agentId: 'planner-1',
        agentTypeSlug: 'general_assistant',
        agentRevision: 'revision-1',
        model: 'azure/fallback-model',
        temperature: 0.2,
        instruction: 'Plan safely',
        omitTemperature: true,
      }),
    };
    const { service, agentService } = createExecutionServiceForTests({ executionSettingsResolver });
    const run = jest.fn().mockReturnValue({ on: jest.fn() });
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {}, {}, {
      nodes: [{ id: 'step-1', kind: 'step', dynamicReasoning: { enabled: true } }],
      controlEdges: [],
      dataBindings: [],
      settings: { inferenceModelId: 'fallback-model' },
    });

    expect(executionSettingsResolver.resolvePlanner).toHaveBeenCalledWith(
      'planner-1',
      { inferenceModelId: 'fallback-model' },
    );
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        playbook_planner: expect.objectContaining({
          model: 'azure/fallback-model',
          agent_type_slug: 'general_assistant',
          omit_temperature: true,
        }),
      }),
    }));
  });
});
