import { describe, expect, it } from 'vitest';
import { formatNextMonthlyOccurrencePreview } from './scheduleDisplay';

describe('formatNextMonthlyOccurrencePreview', () => {
  it('returns a string containing a month name in French locale', () => {
    const s = formatNextMonthlyOccurrencePreview(15, '09:00', 'fr');
    expect(s.length).toBeGreaterThan(5);
    // Long month name in French locale (février, janvier, …)
    expect(s.toLowerCase()).toMatch(/jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc/i);
  });

  it('returns empty for invalid day', () => {
    expect(formatNextMonthlyOccurrencePreview(32, '09:00', 'en')).toBe('');
  });

  it('returns a formatted date for every-day-of-month (0)', () => {
    const s = formatNextMonthlyOccurrencePreview(0, '09:00', 'en');
    expect(s.length).toBeGreaterThan(5);
  });
});
