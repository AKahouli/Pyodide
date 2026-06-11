import {
  flattenAgentParams,
  mapAdkCompatibleTools,
  mapGrpcAgentToAdkSingleAgent,
  sanitizeAdkAgentName,
} from './whatsapp-adk-agent.mapper';
import { IGrpcAgent } from '@modules/agent/interfaces/agent.interface';

const baseGrpcAgent = (overrides: Partial<IGrpcAgent> = {}): IGrpcAgent => ({
  id: 'agent-1',
  name: 'chef cuisine',
  description: 'Cooking assistant',
  prompt: 'You are a chef.',
  agent_type: 'simple',
  save_memory: false,
  tools: [
    { name: 'connector_abc_list', description: 'List repos' },
    { name: 'search', description: 'Search docs', top_k: 5 },
  ],
  brain_context: [],
  chatbot: { model: 'gpt-5.4-mini' },
  agent_params: {
    params: {
      user_id: 'user-1',
      connector_bindings_json: '[{"connector_id":"abc"}]',
    },
  },
  connector_bindings: [{ connector_id: 'abc', actions: [] }],
  skills: [{ id: 's1', name: 'recipes', description: 'Recipe help', instructions: '...' }],
  ...overrides,
});

describe('whatsapp-adk-agent.mapper', () => {
  it('sanitizes agent names for ADK', () => {
    expect(sanitizeAdkAgentName('chef cuisine')).toBe('chef_cuisine');
    expect(sanitizeAdkAgentName('  ')).toBe('whatsapp_agent');
  });

  it('flattens nested agent_params like gRPC', () => {
    const flat = flattenAgentParams(baseGrpcAgent());
    expect(flat?.user_id).toBe('user-1');
    expect(flat?.connector_bindings_json).toBe('[{"connector_id":"abc"}]');
  });

  it('falls back to connector_bindings when json param is missing', () => {
    const flat = flattenAgentParams(
      baseGrpcAgent({
        agent_params: { params: { user_id: 'user-1' } },
        connector_bindings: [{ connector_id: 'xyz', actions: [] }],
      }),
    );
    expect(flat?.connector_bindings_json).toContain('xyz');
  });

  it('strips connector tool stubs from tools list', () => {
    const tools = mapAdkCompatibleTools(baseGrpcAgent().tools);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('search');
  });

  it('maps payload to run_single_agent schema shape', () => {
    const payload = mapGrpcAgentToAdkSingleAgent(baseGrpcAgent(), 'azure/gpt-5.4-mini');
    expect(payload.name).toBe('chef_cuisine');
    expect(payload.model).toBe('azure/gpt-5.4-mini');
    expect(payload.chatbot_name).toEqual({ provider: 'azure/gpt-5.4-mini' });
    expect(payload.instruction).toContain('You are a chef.');
    expect(payload.instruction).toContain('recipes');
    expect('skills' in payload).toBe(false);
    expect(payload.agent_params?.connector_bindings_json).toBeTruthy();
    expect(payload.html).toBe(false);
  });
});
