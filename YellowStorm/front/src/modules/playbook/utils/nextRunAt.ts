import type { ExecutionScheduleData } from '../types';

/**
 * Client-side "next fire time" — the backend stores no next-run field, only the
 * structured schedule params. Computed in the browser's local timezone.
 * ponytail: ignores `schedule.timezone`; users browsing outside the workspace
 * timezone see browser-local fire times. Upgrade path: backend computes and
 * stores nextRunAt when the scheduler ticks.
 */

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const BUFFER_MS = 30_000;

function atTime(day: Date, hm: string): Date | null {
  const m = hm.trim().match(HM);
  if (!m) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
}

function daysAhead(k: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return d;
}

function pickEarliest(candidates: Array<Date | null>): Date | null {
  const now = Date.now() - BUFFER_MS;
  let earliest: Date | null = null;
  for (const c of candidates) {
    if (!c || c.getTime() < now) continue;
    if (!earliest || c < earliest) earliest = c;
  }
  return earliest;
}

function nextDaily(timesLocal: Array<string | undefined> | undefined): Date | null {
  const times = (timesLocal ?? []).filter((t): t is string => !!t);
  if (!times.length) return null;
  const candidates: Array<Date | null> = [];
  for (let k = 0; k < 2; k++) {
    const day = daysAhead(k);
    for (const t of times) candidates.push(atTime(day, t));
  }
  return pickEarliest(candidates);
}

function nextWeekly(slots: Array<{ weekday: number; timeLocal: string }> | undefined): Date | null {
  if (!slots?.length) return null;
  const candidates: Array<Date | null> = [];
  for (let k = 0; k < 8; k++) {
    const day = daysAhead(k);
    for (const s of slots) {
      if (day.getDay() === s.weekday) candidates.push(atTime(day, s.timeLocal));
    }
  }
  return pickEarliest(candidates);
}

function nextMonthly(slots: Array<{ monthOfYear?: number | null; dayOfMonth: number; timeLocal: string }> | undefined): Date | null {
  if (!slots?.length) return null;
  const candidates: Array<Date | null> = [];
  for (const s of slots) {
    for (let k = 0; k < 13; k++) {
      const anchor = new Date();
      anchor.setMonth(anchor.getMonth() + k, 1);
      if (s.monthOfYear != null && anchor.getMonth() + 1 !== s.monthOfYear) continue;
      const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      if (s.dayOfMonth === 0) {
        // "every day of the month" — first day that still fires
        candidates.push(atTime(anchor, s.timeLocal));
        const mid = new Date(anchor.getFullYear(), anchor.getMonth(), 15);
        candidates.push(atTime(mid, s.timeLocal), atTime(new Date(anchor.getFullYear(), anchor.getMonth(), lastDay), s.timeLocal));
        break;
      }
      const dom = s.dayOfMonth === -1 ? lastDay : Math.min(Math.max(1, s.dayOfMonth), lastDay);
      candidates.push(atTime(new Date(anchor.getFullYear(), anchor.getMonth(), dom), s.timeLocal));
    }
  }
  return pickEarliest(candidates);
}

function nextAdvanced(a: NonNullable<ExecutionScheduleData['advanced']>, lastRunAt: string | null): Date | null {
  if (!a?.timeLocal) return null;
  if (a.variant === 'weekdays' || a.variant === 'weekend') {
    const candidates: Array<Date | null> = [];
    for (let k = 0; k < 8; k++) {
      const day = daysAhead(k);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      if (weekend === (a.variant === 'weekend')) candidates.push(atTime(day, a.timeLocal));
    }
    return pickEarliest(candidates);
  }
  if (a.variant === 'every_n_days') {
    const intervalDays = Math.max(1, a.intervalDays ?? 1);
    const anchor = lastRunAt ? new Date(lastRunAt) : new Date();
    for (let k = 0; k <= intervalDays + 1; k++) {
      const day = daysAhead(k);
      const candidate = atTime(day, a.timeLocal);
      if (!candidate) continue;
      const sinceAnchor = (candidate.getTime() - anchor.getTime()) / 86_400_000;
      if (sinceAnchor >= 0 && Math.round(sinceAnchor) % intervalDays === 0) return candidate;
    }
    return null;
  }
  return null;
}

/** Next scheduled fire time as an ISO string, or null when not derivable. */
export function computeNextRunAt(schedule: ExecutionScheduleData | null | undefined): string | null {
  if (!schedule?.enabled || !schedule.type) return null;
  const next =
    schedule.type === 'daily' ? nextDaily(schedule.daily?.timesLocal)
    : schedule.type === 'weekly' ? nextWeekly(schedule.weekly?.slots)
    : schedule.type === 'monthly' ? nextMonthly(schedule.monthly?.slots)
    : schedule.advanced ? nextAdvanced(schedule.advanced, schedule.lastScheduledRunAt)
    : null;
  return next ? next.toISOString() : null;
}
