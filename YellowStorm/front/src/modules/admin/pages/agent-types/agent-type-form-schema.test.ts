import { describe, expect, it } from 'vitest';
import { createAgentTypeFormSchema, defaultFormValues } from './agent-type-form-schema';

const t = (key: string) => key as never;

describe('agent type form schema', () => {
  it('validates name and default prompt constraints', () => {
    const schema = createAgentTypeFormSchema(t);
    const parsed = schema.parse({ name: 'Type-1' });
    expect(parsed.isActive).toBe(true);
    expect(parsed.defaultPrompt).toBe('');

    expect(() => schema.parse({ name: 'Type_1' })).toThrow();
    expect(defaultFormValues.name).toBe('');
  });
});
