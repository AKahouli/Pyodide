import { describe, expect, it } from 'vitest';
import { createAgentFormSchema, defaultFormValues } from './agent-form-schema';

const t = (key: string) => key as never;

describe('agent form schema', () => {
  it('accepts valid values and applies defaults', () => {
    const schema = createAgentFormSchema(t);
    const parsed = schema.parse({
      name: 'Agent 1',
      slug: 'agent-1',
      agentType: 'type-1',
      role: 'assistant',
    });

    expect(parsed.temperature).toBe(0);
    expect(parsed.isActive).toBe(true);
    expect(parsed.tools).toEqual([]);
  });

  it('rejects invalid name pattern', () => {
    const schema = createAgentFormSchema(t);
    expect(() => schema.parse({ name: 'Agent@', agentType: 'x', role: 'r' })).toThrow();
    expect(defaultFormValues.isDefaultForType).toBe(false);
  });

  it('rejects invalid slug pattern', () => {
    const schema = createAgentFormSchema(t);
    expect(() => schema.parse({ name: 'Agent 1', slug: 'Agent 1', agentType: 'x', role: 'r' })).toThrow();
  });
});
