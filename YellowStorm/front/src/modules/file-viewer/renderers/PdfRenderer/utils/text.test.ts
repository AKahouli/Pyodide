import { describe, expect, it } from 'vitest';
import { extractHighlightText } from './text';

describe('extractHighlightText', () => {
  it('extracts text inside page tags and normalizes spaces', () => {
    expect(extractHighlightText('<page number=7>  hello   world  </page>')).toBe('hello world');
  });

  it('returns undefined for empty values', () => {
    expect(extractHighlightText('   ')).toBeUndefined();
    expect(extractHighlightText(null)).toBeUndefined();
    expect(extractHighlightText(undefined)).toBeUndefined();
  });
});
