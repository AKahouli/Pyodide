import type { ExecutionScheduleData } from '../types';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short English summary for badge / subtitles (callers can wrap with i18n for full UX). */
export function summarizeExecutionSchedule(schedule: ExecutionScheduleData | null | undefined): string {
  if (!schedule?.enabled || !schedule.type) {
    return '';
  }
  switch (schedule.type) {
    case 'daily': {
      const times = schedule.daily?.timesLocal?.length ? schedule.daily.timesLocal.join(', ') : '';
      return times ? `Daily ${times}` : 'Daily';
    }
    case 'weekly': {
      const parts = (schedule.weekly?.slots ?? []).map(
        (s) => `${WEEKDAY_SHORT[s.weekday] ?? s.weekday} ${s.timeLocal}`,
      );
      return parts.length ? `Weekly: ${parts.join('; ')}` : 'Weekly';
    }
    case 'monthly': {
      const parts = (schedule.monthly?.slots ?? []).map((s) =>
        s.dayOfMonth === -1 ? `last ${s.timeLocal}` : `${s.dayOfMonth} @ ${s.timeLocal}`,
      );
      return parts.length ? `Monthly: ${parts.join('; ')}` : 'Monthly';
    }
    case 'advanced': {
      const a = schedule.advanced;
      if (!a) return 'Advanced';
      if (a.variant === 'every_n_days') {
        return `Every ${a.intervalDays ?? '?'} day(s) at ${a.timeLocal ?? '?'}`;
      }
      if (a.variant === 'weekdays') {
        return `Weekdays at ${a.timeLocal ?? '?'}`;
      }
      return `Weekend at ${a.timeLocal ?? '?'}`;
    }
    default:
      return '';
  }
}

/** Alias for consumers expecting the shorter name (same as {@link summarizeExecutionSchedule}). */
export const summarizeSchedule = summarizeExecutionSchedule;
