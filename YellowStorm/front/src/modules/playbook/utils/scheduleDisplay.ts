import type { ExecutionScheduleData } from '../types';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const PREVIEW_MAX_ITERATIONS = 60;

const PREVIEW_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/**
 * Next upcoming calendar occurrence of "day N at HH:mm" in the browser's local timezone,
 * formatted with weekday + day + **month name** + time (helps monthly schedule UX).
 */
export function formatNextMonthlyOccurrencePreview(
  dayOfMonth: number,
  timeLocal: string,
  locale: string,
  monthOfYear?: number | null,
): string {
  if (
    !Number.isFinite(dayOfMonth) ||
    (dayOfMonth !== -1 && dayOfMonth !== 0 && (dayOfMonth < 1 || dayOfMonth > 31))
  ) {
    return '';
  }
  if (monthOfYear != null && (monthOfYear < 1 || monthOfYear > 12)) {
    return '';
  }
  const hm = timeLocal.trim().match(HM);
  if (!hm) return '';
  const hour = parseInt(hm[1], 10);
  const minute = parseInt(hm[2], 10);
  const now = new Date();
  const bufferMs = 30_000;

  const fmt = new Intl.DateTimeFormat(locale, PREVIEW_FORMAT_OPTIONS);

  if (dayOfMonth === 0) {
    for (let k = 0; k < PREVIEW_MAX_ITERATIONS; k++) {
      const d = new Date(now);
      d.setDate(d.getDate() + k);
      if (monthOfYear != null && d.getMonth() + 1 !== monthOfYear) continue;
      const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
      if (cand.getTime() >= now.getTime() - bufferMs) {
        return fmt.format(cand);
      }
    }
    return '';
  }

  for (let k = 0; k < 24; k++) {
    const anchor = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const y = anchor.getFullYear();
    const mo = anchor.getMonth();
    if (monthOfYear != null && monthOfYear !== mo + 1) continue;
    const lastDay = new Date(y, mo + 1, 0).getDate();
    const dom = dayOfMonth === -1 ? lastDay : Math.min(Math.max(1, dayOfMonth), lastDay);
    const cand = new Date(y, mo, dom, hour, minute, 0, 0);
    if (cand.getTime() >= now.getTime() - bufferMs) {
      return fmt.format(cand);
    }
  }
  return '';
}

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
      const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parts = (schedule.monthly?.slots ?? []).map((s) => {
        const m =
          s.monthOfYear != null && s.monthOfYear >= 1 && s.monthOfYear <= 12
            ? `${MONTH[s.monthOfYear - 1]} `
            : '';
        const d =
          s.dayOfMonth === 0 ? 'every day' : s.dayOfMonth === -1 ? 'last' : String(s.dayOfMonth);
        return `${m}${d} @ ${s.timeLocal}`;
      });
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
      {
        const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m =
          a.monthOfYear != null && a.monthOfYear >= 1 && a.monthOfYear <= 12
            ? ` ${MONTH[a.monthOfYear - 1]}`
            : '';
        const w =
          a.weekOfMonth != null && a.weekOfMonth >= 1 && a.weekOfMonth <= 5
            ? ` W${a.weekOfMonth}`
            : '';
        return `Weekend${m}${w} at ${a.timeLocal ?? '?'}`;
      }
    }
    default:
      return '';
  }
}

/** Alias for consumers expecting the shorter name (same as {@link summarizeExecutionSchedule}). */
export const summarizeSchedule = summarizeExecutionSchedule;
