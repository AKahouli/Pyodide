import { describe, expect, it } from 'vitest';
import { defaultFormValues, userAgentFormSchema } from './AgentFormSchema';

describe('AgentFormSchema', () => {
  it('accepts valid data and applies defaults', () => {
    const parsed = userAgentFormSchema.parse({
      name: 'Agent One',
      slug: 'agent-one',
      agentType: 'type-1',
      role: 'Do helpful things',
    });

    expect(parsed.isActive).toBe(true);
    expect(parsed.ignorePrePrompt).toBe(false);
    expect(parsed.temperature).toBe(0);
    expect(parsed.tools).toEqual([]);
    expect(parsed.knowledgeBases).toEqual([]);
    expect(parsed.connectorActionSelections).toEqual([]);
    expect(parsed.enable_temporary_child_agents).toBe(false);
    expect(parsed.max_temporary_child_agents).toBe(4);
  });

  it('rejects connector action selections without selected tools', () => {
    expect(() =>
      userAgentFormSchema.parse({
        name: 'Agent One',
        slug: 'agent-one',
        agentType: 'type-1',
        role: 'Do helpful things',
        connectors: ['connector-1'],
        connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: [] }],
      }),
    ).toThrow();
  });

  it('rejects invalid names with non-alphanumeric characters', () => {
    expect(() =>
      userAgentFormSchema.parse({
        name: 'Agent@#',
        slug: 'agent',
        agentType: 'type-1',
        role: 'role',
      }),
    ).toThrow('Name must contain only letters, numbers, and spaces');
  });

  it('provides exported default form values', () => {
    expect(defaultFormValues).toMatchObject({
      name: '',
      agentType: '',
      role: '',
      isActive: true,
      isDefaultForType: false,
      enable_temporary_child_agents: false,
      max_temporary_child_agents: 4,
    });
  });
});
