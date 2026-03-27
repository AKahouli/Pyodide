import { describe, expect, it } from 'vitest';
import { defaultFormValues, userAgentFormSchema } from './AgentFormSchema';

describe('AgentFormSchema', () => {
  it('accepts valid data and applies defaults', () => {
    const parsed = userAgentFormSchema.parse({
      name: 'Agent One',
      agentType: 'type-1',
      role: 'Do helpful things',
    });

    expect(parsed.isActive).toBe(true);
    expect(parsed.ignorePrePrompt).toBe(false);
    expect(parsed.temperature).toBe(0);
    expect(parsed.tools).toEqual([]);
    expect(parsed.knowledgeBases).toEqual([]);
  });

  it('rejects invalid names with non-alphanumeric characters', () => {
    expect(() =>
      userAgentFormSchema.parse({
        name: 'Agent@#',
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
    });
  });
});
