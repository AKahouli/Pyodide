import { decodeNativeInputResponse, matchesNativeInputSchema, sanitizeNativeInputSchema } from './native-input-schema';

describe('Native input boundary', () => {
  it('keeps only bounded data fields and strips remote/private rendering hints', () => {
    expect(sanitizeNativeInputSchema({ type: 'object', properties: {
      answer: { type: 'string', default: 'private-token', description: 'private instructions' },
    }, required: ['answer'], examples: ['private'] })).toEqual({
      type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'],
    });
    expect(sanitizeNativeInputSchema({ $ref: 'https://remote' })).toBeNull();
  });
  it.each(['pattern', 'format', 'anyOf', 'oneOf', '$ref', '$defs', 'multipleOf'])('fails closed for unsupported validation keyword %s', (key) => {
    expect(sanitizeNativeInputSchema({ type: 'string', [key]: 'unsupported' })).toBeNull();
  });
  it('preserves supported constraints and counts string length as Unicode code points', () => {
    const schema = sanitizeNativeInputSchema({ type: 'string', minLength: 2, maxLength: 3 })!;
    expect(matchesNativeInputSchema('a', schema)).toBe(false);
    expect(matchesNativeInputSchema('abcd', schema)).toBe(false);
    expect(matchesNativeInputSchema('😀', schema)).toBe(false);
    expect(matchesNativeInputSchema('😀a', schema)).toBe(true);
    expect(matchesNativeInputSchema(0, { type: 'number', minimum: 1 })).toBe(false);
    expect(matchesNativeInputSchema([1], { type: 'array', minItems: 2, items: { type: 'number' } })).toBe(false);
  });
  it('rejects unbounded property trees and prototype keys', () => {
    expect(sanitizeNativeInputSchema({ type: 'object', properties: { constructor: { type: 'string' } } })).toBeNull();
    expect(sanitizeNativeInputSchema({ type: 'object', properties:
      Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`field${index}`, { type: 'string' }])) })).toBeNull();
  });
  it('preserves an actual result property through a double native envelope', () => {
    const schema = sanitizeNativeInputSchema({ type: 'object', properties: { result: { type: 'string' } } })!;
    expect(matchesNativeInputSchema(decodeNativeInputResponse({ result: { result: 'answer' } }), schema)).toBe(true);
  });
  it('validates required fields, enums, exact scalar types and unknown fields', () => {
    const schema = sanitizeNativeInputSchema({ type: 'object', properties: {
      confirmed: { type: 'boolean' }, count: { type: 'integer', enum: [1, 2] },
    }, required: ['confirmed'] })!;
    expect(matchesNativeInputSchema({ confirmed: false, count: 2 }, schema)).toBe(true);
    for (const invalid of [{}, { confirmed: 'false' }, { confirmed: false, count: 3 },
      { confirmed: false, count: 1.5 }, { confirmed: true, injected: true }]) {
      expect(matchesNativeInputSchema(invalid, schema)).toBe(false);
    }
  });
  it.each([false, 42, ['one'], 'true', '123', 'null', 'ordinary text'])('decodes native scalar %j', (value) => {
    const encoded = typeof value === 'string' ? JSON.stringify(value) : value;
    expect(decodeNativeInputResponse({ result: encoded })).toEqual(value);
  });
});
