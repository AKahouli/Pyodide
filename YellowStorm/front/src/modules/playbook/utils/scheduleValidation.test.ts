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
});
