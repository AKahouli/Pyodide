import { describe, expect, it } from 'vitest';
import { createToolFormSchema, defaultFormValues } from './tool-form-schema';

const t = (key: string) => key as never;

describe('tool form schema', () => {
  it('parses valid values and defaults', () => {
    const schema = createToolFormSchema(t);
    const parsed = schema.parse({ name: 'Tool One' });

    expect(parsed.isActive).toBe(true);
    expect(parsed.attributes).toEqual([]);
    expect(defaultFormValues.defaultAgentTypes).toEqual([]);
  });

  it('validates enum attribute constraints', () => {
    const schema = createToolFormSchema(t);

    expect(() =>
      schema.parse({
        name: 'Tool One',
        attributes: [
          {
            name: 'mode',
            type: 'enum',
            value: 'a',
            options: [],
          },
        ],
      }),
    ).toThrow();
  });
});
