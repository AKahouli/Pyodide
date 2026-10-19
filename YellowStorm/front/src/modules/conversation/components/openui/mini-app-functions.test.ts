import { describe, expect, it } from 'vitest';
import {
  filterTextFunction, formatNumberFunction, joinTextFunction, textMetricsFunction,
} from './mini-app-functions';

describe('bounded OpenUI mini-app functions', () => {
  it('formats zero and finite numbers deterministically and rejects invalid numbers or precision', () => {
    expect(formatNumberFunction.fn({ value: 0, decimals: 2 })).toBe('0.00');
    expect(formatNumberFunction.fn({ value: 1234.567, decimals: 2 })).toBe('1,234.57');
    expect(formatNumberFunction.fn({ value: -12.5, decimals: 0 })).toBe('-13');
    for (const value of [Infinity, -Infinity, NaN, '5', null]) {
      expect(formatNumberFunction.params.safeParse({ value, decimals: 2 }).success).toBe(false);
      expect(() => formatNumberFunction.fn({ value: value as number, decimals: 2 })).toThrow();
    }
    for (const decimals of [-1, 1.5, 13]) {
      expect(formatNumberFunction.params.safeParse({ value: 1, decimals }).success).toBe(false);
      expect(() => formatNumberFunction.fn({ value: 1, decimals })).toThrow();
    }
    expect(formatNumberFunction.returns?.safeParse(formatNumberFunction.fn({ value: Number.MAX_VALUE, decimals: 12 })).success).toBe(true);
  });

  it('handles blank, multiline and Unicode text without treating metrics as a generated summary', () => {
    expect(textMetricsFunction.fn({ text: '' })).toEqual({ characters: 0, words: 0, lines: 0 });
    expect(textMetricsFunction.fn({ text: ' \t ' })).toEqual({ characters: 3, words: 0, lines: 1 });
    expect(textMetricsFunction.fn({ text: 'Résumé café\r\nDeux mots\n' })).toEqual({ characters: 23, words: 4, lines: 3 });
    expect(textMetricsFunction.fn({ text: '🗻' })).toEqual({ characters: 1, words: 1, lines: 1 });
    expect(textMetricsFunction.params.safeParse({ text: 'x'.repeat(20_000) }).success).toBe(true);
    expect(textMetricsFunction.params.safeParse({ text: 'x'.repeat(20_001) }).success).toBe(false);
    expect(() => textMetricsFunction.fn({ text: 'x'.repeat(20_001) })).toThrow();
    expect(() => textMetricsFunction.fn({ text: null as unknown as string })).toThrow();
  });

  it('filters case-insensitively without mutating order, duplicates or source items', () => {
    const items = ['Paris', 'osaka', 'PARIS'];
    expect(filterTextFunction.fn({ items, query: 'par' })).toEqual(['Paris', 'PARIS']);
    expect(filterTextFunction.fn({ items, query: '' })).toEqual(items);
    expect(filterTextFunction.fn({ items, query: 'missing' })).toEqual([]);
    expect(items).toEqual(['Paris', 'osaka', 'PARIS']);
  });

  it('bounds lists by both count and combined text before invoking a function', () => {
    expect(filterTextFunction.params.safeParse({ items: Array(200).fill(''), query: '' }).success).toBe(true);
    expect(filterTextFunction.params.safeParse({ items: Array(201).fill(''), query: '' }).success).toBe(false);
    expect(filterTextFunction.params.safeParse({ items: ['a'.repeat(10_000), 'b'.repeat(10_001)], query: '' }).success).toBe(false);
    expect(filterTextFunction.params.safeParse({ items: [1], query: '' }).success).toBe(false);
    for (const values of [Array(201).fill(''), ['a'.repeat(10_000), 'b'.repeat(10_001)], [1]]) {
      expect(() => filterTextFunction.fn({ items: values as string[], query: '' })).toThrow();
    }
    expect(() => filterTextFunction.fn({ items: [], query: 'x'.repeat(20_001) })).toThrow();
  });

  it('joins empty and selected lists while rejecting excessive output or separator size', () => {
    expect(joinTextFunction.fn({ items: [], separator: '\n' })).toBe('');
    expect(joinTextFunction.fn({ items: ['First', 'Second'], separator: '\n' })).toBe('First\nSecond');
    expect(joinTextFunction.params.safeParse({ items: ['x'], separator: '-'.repeat(101) }).success).toBe(false);
    expect(() => joinTextFunction.fn({ items: ['x'], separator: '-'.repeat(101) })).toThrow();
    expect(() => joinTextFunction.fn({ items: Array(201).fill(''), separator: '' })).toThrow();
    expect(() => joinTextFunction.fn({ items: [1] as unknown as string[], separator: '' })).toThrow();
    const args = { items: ['x'.repeat(10_000), 'y'.repeat(10_000)], separator: '\n' };
    expect(joinTextFunction.params.safeParse(args).success).toBe(true);
    expect(() => joinTextFunction.fn(args)).toThrow();
  });
});
