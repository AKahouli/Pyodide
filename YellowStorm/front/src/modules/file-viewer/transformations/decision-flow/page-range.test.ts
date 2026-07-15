import { describe, expect, it } from 'vitest';
import { PageRangeError, parsePageRange } from './page-range';

describe('parsePageRange', () => {
  const thrownCode = (input: string, pageCount: number) => {
    try { parsePageRange(input, pageCount); } catch (error) { return (error as PageRangeError).code; }
    return undefined;
  };
  it('parses, sorts and deduplicates mixed ranges', () => {
    expect(parsePageRange('8, 3-5, 3, 10', 10)).toEqual([3, 4, 5, 8, 10]);
  });

  it.each(['0', '-1', '11'])('rejects an out-of-bounds page: %s', (input) => {
    expect(() => parsePageRange(input, 10)).toThrow(PageRangeError);
  });

  it('rejects descending ranges', () => {
    expect(thrownCode('5-3', 10)).toBe('descending');
  });

  it('limits a selection to 500 pages', () => {
    expect(thrownCode('1-501', 600)).toBe('tooMany');
  });
});
