import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeNextRunAt } from './nextRunAt';
import type { ExecutionScheduleData } from '../types';

function schedule(partial: Partial<ExecutionScheduleData>): ExecutionScheduleData {
  return {
    enabled: true,
    timezone: 'Europe/Paris',
    lastScheduledRunAt: null,
    daily: null,
    weekly: null,
    monthly: null,
    advanced: null,
    ...partial,
  };
}

describe('computeNextRunAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 13, 8, 0, 0)); // Sunday 2026-09-13 08:00 local
  });
  afterEach(() => vi.useRealTimers());

  it('returns null for disabled or untyped schedules', () => {
    expect(computeNextRunAt(schedule({ enabled: false, type: 'daily', daily: { timesLocal: ['09:00'] } as never }))).toBeNull();
    expect(computeNextRunAt(schedule({ type: undefined }))).toBeNull();
    expect(computeNextRunAt(null)).toBeNull();
  });

  it('daily: later today when the time has not passed', () => {
    const next = computeNextRunAt(schedule({ type: 'daily', daily: { timesLocal: ['09:00'] } as never }));
    expect(next).toBe(new Date(2026, 8, 13, 9, 0).toISOString());
  });

  it('daily: tomorrow when today\'s slot passed', () => {
    const next = computeNextRunAt(schedule({ type: 'daily', daily: { timesLocal: ['07:30'] } as never }));
    expect(next).toBe(new Date(2026, 8, 14, 7, 30).toISOString());
  });

  it('weekly: next matching weekday', () => {
    // Sunday 2026-09-13; next Monday 09:00
    const next = computeNextRunAt(schedule({ type: 'weekly', weekly: { slots: [{ weekday: 1, timeLocal: '09:00' }] } as never }));
    expect(next).toBe(new Date(2026, 8, 14, 9, 0).toISOString());
  });

  it('monthly: same day later this month', () => {
    const next = computeNextRunAt(schedule({ type: 'monthly', monthly: { slots: [{ dayOfMonth: 20, timeLocal: '10:00' }] } as never }));
    expect(next).toBe(new Date(2026, 8, 20, 10, 0).toISOString());
  });

  it('monthly: rolls to next month when the day passed', () => {
    const next = computeNextRunAt(schedule({ type: 'monthly', monthly: { slots: [{ dayOfMonth: 5, timeLocal: '10:00' }] } as never }));
    expect(next).toBe(new Date(2026, 9, 5, 10, 0).toISOString());
  });

  it('advanced every_n_days steps from the last scheduled run', () => {
    const last = new Date(2026, 8, 10, 6, 0).toISOString();
    const next = computeNextRunAt(schedule({
      type: 'advanced',
      lastScheduledRunAt: last,
      advanced: { variant: 'every_n_days', intervalDays: 3, timeLocal: '06:00' } as never,
    }));
    expect(next).toBe(new Date(2026, 8, 13, 6, 0).toISOString());
  });

  it('advanced weekdays skips the weekend', () => {
    const next = computeNextRunAt(schedule({ type: 'advanced', advanced: { variant: 'weekdays', timeLocal: '09:00' } as never }));
    expect(next).toBe(new Date(2026, 8, 14, 9, 0).toISOString());
  });
});
