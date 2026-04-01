import {
  daysBetweenYmd,
  isExecutionScheduleDueThisMinute,
  shouldRunScheduledExecution,
  zonedYmd,
  type ScheduleEvalInput,
} from './playbook-schedule.util';

describe('playbook-schedule.util', () => {
  describe('zonedYmd / daysBetweenYmd', () => {
    it('zonedYmd formats YYYY-MM-DD in UTC', () => {
      const d = new Date('2026-03-15T12:00:00.000Z');
      expect(zonedYmd(d, 'UTC')).toBe('2026-03-15');
    });

    it('daysBetweenYmd returns calendar day difference', () => {
      expect(daysBetweenYmd('2026-01-01', '2026-01-08')).toBe(7);
      expect(daysBetweenYmd('2026-01-10', '2026-01-10')).toBe(0);
    });
  });

  describe('isExecutionScheduleDueThisMinute / shouldRunScheduledExecution', () => {
    it('returns false when schedule is disabled or missing type', () => {
      expect(isExecutionScheduleDueThisMinute(undefined)).toBe(false);
      expect(isExecutionScheduleDueThisMinute({ enabled: false, type: 'daily' } as ScheduleEvalInput)).toBe(false);
      expect(isExecutionScheduleDueThisMinute({ enabled: true } as ScheduleEvalInput)).toBe(false);
    });

    it('aliases shouldRunScheduledExecution to isExecutionScheduleDueThisMinute', () => {
      const s: ScheduleEvalInput = {
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        daily: { timesLocal: ['00:00'] },
      };
      const now = new Date('2026-06-01T00:00:00.000Z');
      expect(shouldRunScheduledExecution(s, now)).toBe(isExecutionScheduleDueThisMinute(s, now));
    });

    describe('daily (multi-hour)', () => {
      const base = (): ScheduleEvalInput => ({
        enabled: true,
        timezone: 'UTC',
        type: 'daily',
        lastScheduledRunAt: null,
        daily: { timesLocal: ['09:00', '14:30', '23:59'] },
        weekly: null,
        monthly: null,
        advanced: null,
      });

      it('matches one of several timesLocal', () => {
        expect(isExecutionScheduleDueThisMinute(base(), new Date('2026-01-10T09:00:00.000Z'))).toBe(true);
        expect(isExecutionScheduleDueThisMinute(base(), new Date('2026-01-10T14:30:00.000Z'))).toBe(true);
        expect(isExecutionScheduleDueThisMinute(base(), new Date('2026-01-10T23:59:00.000Z'))).toBe(true);
      });

      it('does not match when minute differs', () => {
        expect(isExecutionScheduleDueThisMinute(base(), new Date('2026-01-10T09:01:00.000Z'))).toBe(false);
        expect(isExecutionScheduleDueThisMinute(base(), new Date('2026-01-10T14:00:00.000Z'))).toBe(false);
      });
    });

    describe('weekly (hour per weekday)', () => {
      const schedule = (): ScheduleEvalInput => ({
        enabled: true,
        timezone: 'UTC',
        type: 'weekly',
        lastScheduledRunAt: null,
        daily: null,
        weekly: {
          slots: [
            { weekday: 1, timeLocal: '10:00' },
            { weekday: 3, timeLocal: '15:00' },
          ],
        },
        monthly: null,
        advanced: null,
      });

      it('matches weekday + time (Monday 10:00 UTC)', () => {
        // 2026-01-05 is Monday
        const mon = new Date('2026-01-05T10:00:00.000Z');
        expect(isExecutionScheduleDueThisMinute(schedule(), mon)).toBe(true);
      });

      it('matches Wednesday 15:00 UTC', () => {
        const wed = new Date('2026-01-07T15:00:00.000Z');
        expect(isExecutionScheduleDueThisMinute(schedule(), wed)).toBe(true);
      });

      it('does not match wrong weekday', () => {
        const tue = new Date('2026-01-06T10:00:00.000Z');
        expect(isExecutionScheduleDueThisMinute(schedule(), tue)).toBe(false);
      });
    });

    describe('monthly (fixed day and last day)', () => {
      it('matches fixed dayOfMonth', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'monthly',
          lastScheduledRunAt: null,
          daily: null,
          weekly: null,
          monthly: {
            slots: [{ dayOfMonth: 15, timeLocal: '08:00' }],
          },
          advanced: null,
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-03-15T08:00:00.000Z'))).toBe(true);
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-03-14T08:00:00.000Z'))).toBe(false);
      });

      it('matches dayOfMonth -1 as last day of month', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'monthly',
          lastScheduledRunAt: null,
          daily: null,
          weekly: null,
          monthly: {
            slots: [{ dayOfMonth: -1, timeLocal: '10:00' }],
          },
          advanced: null,
        };
        // Jan 2026 has 31 days
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-31T10:00:00.000Z'))).toBe(true);
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-30T10:00:00.000Z'))).toBe(false);
      });
    });

    describe('advanced', () => {
      it('weekdays: Mon–Fri at time only', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'advanced',
          lastScheduledRunAt: null,
          daily: null,
          weekly: null,
          monthly: null,
          advanced: {
            variant: 'weekdays',
            timeLocal: '07:00',
            intervalDays: null,
          },
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-05T07:00:00.000Z'))).toBe(true); // Mon
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-04T07:00:00.000Z'))).toBe(false); // Sun
      });

      it('weekend: Sat/Sun', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'advanced',
          lastScheduledRunAt: null,
          daily: null,
          weekly: null,
          monthly: null,
          advanced: {
            variant: 'weekend',
            timeLocal: '12:00',
            intervalDays: null,
          },
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-04T12:00:00.000Z'))).toBe(true); // Sun
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-03T12:00:00.000Z'))).toBe(true); // Sat
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-01-05T12:00:00.000Z'))).toBe(false); // Mon
      });

      it('every_n_days: first run when lastScheduledRunAt is null', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'advanced',
          lastScheduledRunAt: null,
          daily: null,
          weekly: null,
          monthly: null,
          advanced: {
            variant: 'every_n_days',
            intervalDays: 7,
            timeLocal: '06:00',
          },
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-02-01T06:00:00.000Z'))).toBe(true);
      });

      it('every_n_days: requires interval calendar days since last run', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'advanced',
          lastScheduledRunAt: new Date('2026-02-01T06:00:00.000Z'),
          daily: null,
          weekly: null,
          monthly: null,
          advanced: {
            variant: 'every_n_days',
            intervalDays: 3,
            timeLocal: '06:00',
          },
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-02-03T06:00:00.000Z'))).toBe(false);
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-02-04T06:00:00.000Z'))).toBe(true);
      });
    });

    describe('same-minute dedupe (anti double-fire)', () => {
      it('returns false if lastScheduledRunAt is same zoned minute as now', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'UTC',
          type: 'daily',
          lastScheduledRunAt: new Date('2026-05-01T11:00:00.000Z'),
          daily: { timesLocal: ['11:00'] },
          weekly: null,
          monthly: null,
          advanced: null,
        };
        expect(isExecutionScheduleDueThisMinute(s, new Date('2026-05-01T11:00:00.000Z'))).toBe(false);
      });
    });

    describe('non-UTC timezone', () => {
      it('uses Europe/Paris for local hour', () => {
        const s: ScheduleEvalInput = {
          enabled: true,
          timezone: 'Europe/Paris',
          type: 'daily',
          lastScheduledRunAt: null,
          daily: { timesLocal: ['14:00'] },
          weekly: null,
          monthly: null,
          advanced: null,
        };
        // 2026-01-15 14:00 in Paris is 13:00 UTC (CET, UTC+1)
        const now = new Date('2026-01-15T13:00:00.000Z');
        expect(isExecutionScheduleDueThisMinute(s, now)).toBe(true);
      });
    });
  });
});
