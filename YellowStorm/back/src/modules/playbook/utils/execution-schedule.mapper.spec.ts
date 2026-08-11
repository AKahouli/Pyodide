import { mapExecutionScheduleToData } from './execution-schedule.mapper';

describe('mapExecutionScheduleToData', () => {
  it('returns null for null input', () => {
    expect(mapExecutionScheduleToData(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(mapExecutionScheduleToData(undefined)).toBeNull();
  });

  it('returns null for a non-object (string)', () => {
    expect(mapExecutionScheduleToData('not an object')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(mapExecutionScheduleToData([1, 2, 3])).toBeNull();
  });

  it('returns null for a number', () => {
    expect(mapExecutionScheduleToData(42)).toBeNull();
  });

  it('maps a full daily schedule correctly', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'Europe/Paris',
      type: 'daily',
      lastScheduledRunAt: new Date('2026-01-15T09:00:00.000Z'),
      daily: { timesLocal: ['09:00', '18:00'] },
      weekly: null,
      monthly: null,
      advanced: null,
    });

    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
    expect(result!.timezone).toBe('Europe/Paris');
    expect(result!.type).toBe('daily');
    expect(result!.lastScheduledRunAt).toBe('2026-01-15T09:00:00.000Z');
    expect(result!.daily).toEqual({ timesLocal: ['09:00', '18:00'] });
    expect(result!.weekly).toBeNull();
    expect(result!.monthly).toBeNull();
    expect(result!.advanced).toBeNull();
  });

  it('maps disabled schedule', () => {
    const result = mapExecutionScheduleToData({
      enabled: false,
      timezone: 'UTC',
      type: undefined,
      lastScheduledRunAt: null,
      daily: null,
      weekly: null,
      monthly: null,
      advanced: null,
    });

    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(false);
    expect(result!.type).toBeUndefined();
    expect(result!.lastScheduledRunAt).toBeNull();
  });

  it('defaults timezone to UTC when empty or missing', () => {
    const result1 = mapExecutionScheduleToData({ enabled: true });
    expect(result1!.timezone).toBe('UTC');

    const result2 = mapExecutionScheduleToData({ enabled: true, timezone: '' });
    expect(result2!.timezone).toBe('UTC');
  });

  it('maps unknown type to undefined', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      type: 'quarterly',
    });
    expect(result!.type).toBeUndefined();
  });

  it('maps weekly schedule with slots', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'weekly',
      weekly: { slots: [{ weekday: 1, timeLocal: '10:00' }] },
    });
    expect(result!.weekly).toEqual({ slots: [{ weekday: 1, timeLocal: '10:00' }] });
  });

  it('maps monthly schedule with monthOfYear', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'monthly',
      monthly: {
        slots: [{ monthOfYear: 6, dayOfMonth: 15, timeLocal: '08:00' }],
      },
    });
    expect(result!.monthly).toEqual({
      slots: [{ monthOfYear: 6, dayOfMonth: 15, timeLocal: '08:00' }],
    });
  });

  it('maps NaN monthOfYear to null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'monthly',
      monthly: {
        slots: [{ monthOfYear: NaN, dayOfMonth: 15, timeLocal: '08:00' }],
      },
    });
    expect(result!.monthly!.slots[0].monthOfYear).toBeNull();
  });

  it('maps null monthOfYear to null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'monthly',
      monthly: {
        slots: [{ monthOfYear: null, dayOfMonth: 15, timeLocal: '08:00' }],
      },
    });
    expect(result!.monthly!.slots[0].monthOfYear).toBeNull();
  });

  it('maps undefined monthOfYear to null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'monthly',
      monthly: {
        slots: [{ dayOfMonth: 15, timeLocal: '08:00' }],
      },
    });
    expect(result!.monthly!.slots[0].monthOfYear).toBeNull();
  });

  it('maps advanced schedule with all variants', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'advanced',
      advanced: {
        variant: 'weekdays',
        intervalDays: null,
        timeLocal: '07:00',
        monthOfYear: null,
        weekOfMonth: null,
      },
    });
    expect(result!.advanced).toEqual({
      variant: 'weekdays',
      intervalDays: null,
      timeLocal: '07:00',
      monthOfYear: null,
      weekOfMonth: null,
    });
  });

  it('falls back to weekdays for unknown advanced variant', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'advanced',
      advanced: {
        variant: 'custom',
        intervalDays: null,
        timeLocal: '09:00',
        monthOfYear: null,
        weekOfMonth: null,
      },
    });
    expect(result!.advanced!.variant).toBe('weekdays');
  });

  it('converts valid Date lastScheduledRunAt to ISO string', () => {
    const d = new Date('2026-03-15T12:00:00.000Z');
    const result = mapExecutionScheduleToData({
      enabled: true,
      lastScheduledRunAt: d,
    });
    expect(result!.lastScheduledRunAt).toBe('2026-03-15T12:00:00.000Z');
  });

  it('maps invalid Date to null for lastScheduledRunAt', () => {
    const invalidDate = new Date('invalid');
    expect(Number.isNaN(invalidDate.getTime())).toBe(true);
    const result = mapExecutionScheduleToData({
      enabled: true,
      lastScheduledRunAt: invalidDate,
    });
    expect(result!.lastScheduledRunAt).toBeNull();
  });

  it('maps string lastScheduledRunAt through', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      lastScheduledRunAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result!.lastScheduledRunAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps null lastScheduledRunAt to null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      lastScheduledRunAt: null,
    });
    expect(result!.lastScheduledRunAt).toBeNull();
  });

  it('handles missing daily timesLocal by returning empty array', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      type: 'daily',
      daily: {},
    });
    expect(result!.daily).toEqual({ timesLocal: [] });
  });

  it('handles null daily by returning null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      type: 'daily',
      daily: null,
    });
    expect(result!.daily).toBeNull();
  });

  it('handles missing weekly slots by returning empty array', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      type: 'weekly',
      weekly: {},
    });
    expect(result!.weekly).toEqual({ slots: [] });
  });

  it('handles null advanced by returning null', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      type: 'advanced',
      advanced: null,
    });
    expect(result!.advanced).toBeNull();
  });

  it('tolerates partial/legacy shapes with extra fields', () => {
    const result = mapExecutionScheduleToData({
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      unknownField: 'should be ignored',
      daily: { timesLocal: ['09:00'], extraProp: true },
    });
    expect(result!.enabled).toBe(true);
    expect(result!.daily).toEqual({ timesLocal: ['09:00'] });
  });

  it('coerces enabled to boolean', () => {
    const result = mapExecutionScheduleToData({ enabled: 1, timezone: 'UTC' });
    expect(result!.enabled).toBe(true);

    const result2 = mapExecutionScheduleToData({ enabled: 0, timezone: 'UTC' });
    expect(result2!.enabled).toBe(false);

    const result3 = mapExecutionScheduleToData({ enabled: '', timezone: 'UTC' });
    expect(result3!.enabled).toBe(false);
  });
});
