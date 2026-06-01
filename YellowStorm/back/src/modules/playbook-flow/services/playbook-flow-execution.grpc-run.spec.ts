import { toGrpcStruct } from './playbook-flow-execution.service';
import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

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

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-1',
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: toGrpcStruct({
            execution_mode: 'live',
            assignedAgentId: 'agent-1',
            agent_name: 'Research agent',
            agent_description: 'Find and summarize',
            agent_model: 'gpt-4o-mini',
            agent_prompt: 'Use tools when needed.',
            agent_type: 'specialist',
            agent_tools: [{ name: 'calculator', description: 'Math helper' }],
              agent_params: {
                user_id: 'owner-1',
                session_id: 'exec-1',
                connector_bindings_json: '[{"connector_id":"conn-1"}]',
              },
            connector_bindings: [{
              connector_id: 'conn-1',
              connector_name: 'Drive',
              actions: [{ action_key: 'search', description: 'Search Drive' }],
            }],
            brain_context: [{ workspace_id: 'brain-1', workspace_documents: [] }],
          }),
        })],
      }),
    }));
    expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
      'owner-1',
      ['agent-1'],
      undefined,
      'exec-1',
    );
  });
});
