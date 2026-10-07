import { stripNul } from './json';

describe('stripNul', () => {
  it('removes U+0000 from strings, object keys, arrays and nested values', () => {
    const input = {
      'k\u0000ey': 'a\u0000b',
      list: ['x\u0000', { deep: '\u0000y' }, 7, null, true],
    };
    expect(stripNul(input)).toEqual({ key: 'ab', list: ['x', { deep: 'y' }, 7, null, true] });
  });

  it('does not mutate its input', () => {
    const input = { text: 'a\u0000b', nested: { text: 'c\u0000d' } };
    stripNul(input);
    expect(input).toEqual({ text: 'a\u0000b', nested: { text: 'c\u0000d' } });
  });

  it('leaves clean values, primitives and non-plain objects untouched', () => {
    const date = new Date(0);
    const nothing: unknown = undefined;
    expect(stripNul('plain')).toBe('plain');
    expect(stripNul(42)).toBe(42);
    expect(stripNul(null)).toBeNull();
    expect(stripNul(nothing)).toBeUndefined();
    expect(stripNul(date)).toBe(date);
    expect(stripNul({ a: 1, b: ['c'] })).toEqual({ a: 1, b: ['c'] });
  });

  it('keeps every other control character, only U+0000 is invalid in Postgres', () => {
    expect(stripNul('tab\t nl\n cr\r bell\u0007')).toBe('tab\t nl\n cr\r bell\u0007');
  });
});
