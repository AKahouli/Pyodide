import { buildExecutionScheduleDocument } from './execution-schedule-upsert.builder';
import { BadRequestException } from '../../exceptions';

describe('buildExecutionScheduleDocument', () => {
  const disabledDto = { enabled: false, timezone: 'UTC' };

  it('returns disabled envelope with all mode payloads null and lastScheduledRunAt null', () => {
    const result = buildExecutionScheduleDocument(disabledDto, new Date('2026-01-01'));
    expect(result).toEqual({
      enabled: false,
      timezone: 'UTC',
      type: undefined,
      lastScheduledRunAt: null,
      daily: null,
      weekly: null,
      monthly: null,
      advanced: null,
    });
  });

  it('ignores preserveLastRunAt when disabled', () => {
    const preserved = new Date('2026-06-01T09:00:00.000Z');
    const result = buildExecutionScheduleDocument(disabledDto, preserved);
    expect(result.lastScheduledRunAt).toBeNull();
  });

  it('preserves lastScheduledRunAt when enabled', () => {
    const preserved = new Date('2026-06-01T09:00:00.000Z');
    const result = buildExecutionScheduleDocument(
      { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } },
      preserved,
    );
    expect(result.lastScheduledRunAt).toBe(preserved);
  });

  it('sets lastScheduledRunAt to null when enabled but no preserved value', () => {
    const result = buildExecutionScheduleDocument(
      { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } },
      null,
    );
    expect(result.lastScheduledRunAt).toBeNull();
  });

  it('builds daily schedule with timesLocal array', () => {
    const result = buildExecutionScheduleDocument(
      { enabled: true, timezone: 'Europe/Paris', type: 'daily', daily: { timesLocal: ['08:00', '18:00'] } },
      null,
    );
    expect(result.enabled).toBe(true);
    expect(result.timezone).toBe('Europe/Paris');
    expect(result.type).toBe('daily');
    expect(result.daily).toEqual({ timesLocal: ['08:00', '18:00'] });
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.advanced).toBeNull();
  });

  it('builds weekly schedule with mapped slots', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        weekly: { slots: [{ weekday: 1, timeLocal: '10:00' }, { weekday: 5, timeLocal: '17:00' }] },
      },
      null,
    );
    expect(result.weekly).toEqual({
      slots: [{ weekday: 1, timeLocal: '10:00' }, { weekday: 5, timeLocal: '17:00' }],
    });
    expect(result.daily).toBeNull();
  });

  it('builds monthly schedule with mapped slots', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ monthOfYear: 6, dayOfMonth: 15, timeLocal: '08:00' }] },
      },
      null,
    );
    expect(result.monthly).toEqual({
      slots: [{ monthOfYear: 6, dayOfMonth: 15, timeLocal: '08:00' }],
    });
    expect(result.daily).toBeNull();
  });

  it('builds monthly schedule with null monthOfYear', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ dayOfMonth: -1, timeLocal: '10:00' }] },
      },
      null,
    );
    expect(result.monthly).toEqual({
      slots: [{ monthOfYear: null, dayOfMonth: -1, timeLocal: '10:00' }],
    });
  });

  it('builds advanced weekdays schedule', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'weekdays', timeLocal: '07:00', monthOfYear: null, weekOfMonth: null },
      },
      null,
    );
    expect(result.advanced).toEqual({
      variant: 'weekdays',
      intervalDays: null,
      timeLocal: '07:00',
      monthOfYear: null,
      weekOfMonth: null,
    });
  });

  it('builds advanced every_n_days schedule with intervalDays', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'every_n_days', intervalDays: 3, timeLocal: '06:00', monthOfYear: null, weekOfMonth: null },
      },
      null,
    );
    expect(result.advanced).toEqual({
      variant: 'every_n_days',
      intervalDays: 3,
      timeLocal: '06:00',
      monthOfYear: null,
      weekOfMonth: null,
    });
  });

  it('builds advanced weekend schedule with monthOfYear and weekOfMonth', () => {
    const result = buildExecutionScheduleDocument(
      {
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'weekend', timeLocal: '12:00', monthOfYear: 7, weekOfMonth: 2 },
      },
      null,
    );
    expect(result.advanced).toEqual({
      variant: 'weekend',
      intervalDays: null,
      timeLocal: '12:00',
      monthOfYear: 7,
      weekOfMonth: 2,
    });
  });

  it('defaults timezone to UTC when omitted', () => {
    const result = buildExecutionScheduleDocument(
      { enabled: true, type: 'daily', daily: { timesLocal: ['09:00'] } },
      null,
    );
    expect(result.timezone).toBe('UTC');
  });

  it('throws BadRequestException when enabled but type is missing', () => {
    expect(() => buildExecutionScheduleDocument({ enabled: true, timezone: 'UTC' } as any, null)).toThrow(
      BadRequestException,
    );
  });
});
