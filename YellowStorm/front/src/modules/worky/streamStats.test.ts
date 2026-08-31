import { describe, it, expect } from 'vitest';
import {
  STREAM_STATUS_GROUPS,
  formatElapsedMinutes,
  sumStatusCounts,
} from './streamStats';

describe('streamStats', () => {
  describe('STREAM_STATUS_GROUPS', () => {
    it('partitions all 13 stream statuses across groups with no overlap', () => {
      const all = Object.values(STREAM_STATUS_GROUPS).flat();
      expect(new Set(all).size).toBe(all.length); // no duplicates
      expect(all).toHaveLength(13);
    });
  });

  describe('formatElapsedMinutes', () => {
    it('formats sub-hour durations as minutes', () => {
      expect(formatElapsedMinutes(45)).toBe('45m');
    });

    it('formats multi-hour durations as Hh Mm', () => {
      expect(formatElapsedMinutes(134)).toBe('2h 14m');
    });

    it('drops the minutes when on the hour', () => {
      expect(formatElapsedMinutes(120)).toBe('2h');
    });

    it('renders zero as 0m', () => {
      expect(formatElapsedMinutes(0)).toBe('0m');
    });
  });

  describe('sumStatusCounts', () => {
    it('sums the counts for the given statuses, treating missing keys as 0', () => {
      const counts = { active: 3, planning: 2, paused: 1 };
      expect(sumStatusCounts(counts, ['active', 'planning', 'start_requested'])).toBe(5);
    });

    it('returns 0 for an empty status list', () => {
      expect(sumStatusCounts({ active: 3 }, [])).toBe(0);
    });
  });
});
