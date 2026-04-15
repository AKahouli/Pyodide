import { describe, expect, it } from 'vitest';
import { formatPlaybookDateTime } from './formatPlaybookDateTime';

describe('formatPlaybookDateTime', () => {
  it('returns em dash for nullish input', () => {
    expect(formatPlaybookDateTime(null)).toBe('—');
    expect(formatPlaybookDateTime(undefined)).toBe('—');
  });

  it('formats a valid ISO string', () => {
    const s = formatPlaybookDateTime('2026-03-15T14:30:00.000Z');
    expect(s).not.toBe('—');
    expect(s.length).toBeGreaterThan(4);
  });

  it('accepts explicit timezone when valid', () => {
    const s = formatPlaybookDateTime('2026-01-15T12:00:00.000Z', { timeZone: 'UTC' });
    expect(s).not.toBe('—');
  });
});
