import { describe, expect, it } from 'vitest';
import type { UpsertPlaybookScheduleData } from '../types';
import { validateUpsertSchedulePayload, type UpsertScheduleValidationInput } from './scheduleValidation';

describe('validateUpsertSchedulePayload', () => {
  it('allows disabled payload', () => {
    expect(validateUpsertSchedulePayload({ enabled: false })).toBeNull();
  });

  it('requires timezone when enabled', () => {
    const incomplete: UpsertScheduleValidationInput = {
      enabled: true,
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    };
    expect(validateUpsertSchedulePayload(incomplete)).toBe('schedule.validation.timezone');
  });

  it('accepts valid daily', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: ['09:00', '18:00'] },
      }),
    ).toBeNull();
  });

  it('rejects invalid time format', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: ['25:00'] },
      }),
    ).toBe('schedule.validation.timeFormat');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: ['abc'] },
      }),
    ).toBe('schedule.validation.timeFormat');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: ['09:00', '24:01'] },
      }),
    ).toBe('schedule.validation.timeFormat');
  });

  it('requires at least one time for daily', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: [] },
      }),
    ).toBe('schedule.validation.times');
  });

  it('requires at least one slot for weekly', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        weekly: { slots: [] },
      }),
    ).toBe('schedule.validation.slots');
  });

  it('rejects invalid weekday range', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        weekly: { slots: [{ weekday: -1, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.weekday');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        weekly: { slots: [{ weekday: 7, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.weekday');
  });

  it('accepts valid weekly', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        weekly: { slots: [{ weekday: 1, timeLocal: '09:00' }, { weekday: 5, timeLocal: '17:00' }] },
      }),
    ).toBeNull();
  });

  it('rejects invalid day-of-month', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ dayOfMonth: -2, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.dayOfMonth');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ dayOfMonth: 32, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.dayOfMonth');
  });

  it('accepts special day-of-month values (0, -1)', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ dayOfMonth: 0, timeLocal: '09:00' }] },
      }),
    ).toBeNull();

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ dayOfMonth: -1, timeLocal: '09:00' }] },
      }),
    ).toBeNull();
  });

  it('rejects invalid month-of-year', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ monthOfYear: 0, dayOfMonth: 15, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.monthOfYear');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ monthOfYear: 13, dayOfMonth: 15, timeLocal: '09:00' }] },
      }),
    ).toBe('schedule.validation.monthOfYear');
  });

  it('accepts valid monthly', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [{ monthOfYear: 6, dayOfMonth: 15, timeLocal: '10:30' }] },
      }),
    ).toBeNull();
  });

  it('requires at least one slot for monthly', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'monthly',
        monthly: { slots: [] },
      }),
    ).toBe('schedule.validation.slots');
  });

  it('rejects missing advanced data', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
      }),
    ).toBe('schedule.validation.advanced');
  });

  it('rejects advanced every_n_days with invalid interval', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'every_n_days', intervalDays: 0, timeLocal: '09:00', monthOfYear: null, weekOfMonth: null },
      }),
    ).toBe('schedule.validation.interval');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'every_n_days', intervalDays: 400, timeLocal: '09:00', monthOfYear: null, weekOfMonth: null },
      }),
    ).toBe('schedule.validation.interval');

    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'every_n_days', intervalDays: null, timeLocal: '09:00', monthOfYear: null, weekOfMonth: null },
      }),
    ).toBe('schedule.validation.interval');
  });

  it('accepts valid advanced every_n_days', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'every_n_days', intervalDays: 3, timeLocal: '09:00', monthOfYear: null, weekOfMonth: null },
      }),
    ).toBeNull();
  });

  it('rejects advanced weekend with invalid weekOfMonth', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'weekend', intervalDays: null, timeLocal: '09:00', monthOfYear: null, weekOfMonth: 6 },
      }),
    ).toBe('schedule.validation.weekOfMonth');
  });

  it('accepts valid advanced weekend', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'weekend', intervalDays: null, timeLocal: '09:00', monthOfYear: 7, weekOfMonth: 2 },
      }),
    ).toBeNull();
  });

  it('accepts valid advanced weekdays', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
        type: 'advanced',
        advanced: { variant: 'weekdays', intervalDays: null, timeLocal: '09:00', monthOfYear: null, weekOfMonth: null },
      }),
    ).toBeNull();
  });

  it('requires type when enabled', () => {
    expect(
      validateUpsertSchedulePayload({
        enabled: true,
        timezone: 'UTC',
      }),
    ).toBe('schedule.validation.type');
  });
});
