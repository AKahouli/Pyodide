import { describe, expect, it } from 'vitest';
import {
  RECENT_CHATS_CAP,
  buildHistoryRows,
  dayBucket,
  disambiguateTitles,
  groupByDay,
} from './chatGroups';

const NOW = new Date('2026-09-13T15:00:00').getTime();
const today = (h: number) => new Date(`2026-09-13T${String(h).padStart(2, '0')}:00:00`).getTime();
const yesterday = (h: number) => new Date(`2026-09-12T${String(h).padStart(2, '0')}:00:00`).getTime();
const lastWeek = new Date('2026-09-09T10:00:00').getTime();
const old = new Date('2026-05-01T10:00:00').getTime();

describe('dayBucket', () => {
  it('buckets relative to the start of the current day', () => {
    expect(dayBucket(today(1), NOW)).toBe('today');
    expect(dayBucket(yesterday(23), NOW)).toBe('yesterday');
    expect(dayBucket(lastWeek, NOW)).toBe('last7');
    expect(dayBucket(old, NOW)).toBe('older');
  });

  it('treats late yesterday as yesterday, not last7', () => {
    expect(dayBucket(new Date('2026-09-12T23:59:00').getTime(), NOW)).toBe('yesterday');
  });
});

describe('groupByDay', () => {
  it('groups newest-first rows, keeps order, omits empty buckets', () => {
    const rows = [
      { id: '1', title: 'a', sortTime: today(9) },
      { id: '2', title: 'b', sortTime: today(8) },
      { id: '3', title: 'c', sortTime: yesterday(10) },
      { id: '4', title: 'd', sortTime: old },
    ];
    expect(groupByDay(rows, NOW)).toEqual([
      { bucket: 'today', rows: [rows[0], rows[1]] },
      { bucket: 'yesterday', rows: [rows[2]] },
      { bucket: 'older', rows: [rows[3]] },
    ]);
  });
});

describe('disambiguateTitles', () => {
  it('suffixes only duplicated titles', () => {
    const rows = [
      { id: '1', title: 'Poem', sortTime: today(9) },
      { id: '2', title: 'Poem', sortTime: yesterday(9) },
      { id: '3', title: 'Unique', sortTime: today(8) },
    ];
    const out = disambiguateTitles(rows, NOW);
    expect(out[0].displayTitle).toMatch(/^Poem · \d{2}:\d{2}/);
    expect(out[1].displayTitle).toMatch(/^Poem · \w{3} \d{1,2}$/);
    expect(out[2].displayTitle).toBe('Unique');
  });
});

describe('buildHistoryRows', () => {
  it('merges v1 and v2 newest-first with routes', () => {
    const rows = buildHistoryRows(
      [{ id: 'c1', title: 'Older v1', createdAt: '2026-09-10T10:00:00Z', updatedAt: null, lastMessageAt: null }],
      [{ sessionId: 's1', title: null, lastEventAt: '2026-09-13T10:00:00Z' }],
      'Untitled',
    );
    expect(rows.map((r) => r.id)).toEqual(['s1', 'c1']);
    expect(rows[0].title).toBe('Untitled');
    expect(rows[0].to).toBe('/conversation-v2/s1');
    expect(rows[1].to).toBe('/conversation/c1');
  });

  it('cap constant is 25', () => {
    expect(RECENT_CHATS_CAP).toBe(25);
  });
});
