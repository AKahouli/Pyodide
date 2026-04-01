import type { ExecutionScheduleType } from '../schemas/execution-schedule.schema';

/** Lean / plain object shape from Mongo (or DTO) for evaluation. */
export type ScheduleEvalInput = {
  enabled?: boolean;
  timezone?: string;
  type?: ExecutionScheduleType;
  lastScheduledRunAt?: Date | null;
  daily?: { timesLocal?: string[] } | null;
  weekly?: { slots?: Array<{ weekday: number; timeLocal: string }> } | null;
  monthly?: { slots?: Array<{ dayOfMonth: number; timeLocal: string }> } | null;
  advanced?: {
    variant: 'weekdays' | 'weekend' | 'every_n_days';
    intervalDays?: number | null;
    timeLocal?: string | null;
  } | null;
};

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHm(s: string): { h: number; m: number } | null {
  const m = s.trim().match(HM);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

/** YYYY-MM-DD in IANA `timeZone`. */
export function zonedYmd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Calendar day difference (Gregorian) between two YYYY-MM-DD strings. */
export function daysBetweenYmd(a: string, b: string): number {
  const t1 = Date.UTC(
    parseInt(a.slice(0, 4), 10),
    parseInt(a.slice(5, 7), 10) - 1,
    parseInt(a.slice(8, 10), 10),
  );
  const t2 = Date.UTC(
    parseInt(b.slice(0, 4), 10),
    parseInt(b.slice(5, 7), 10) - 1,
    parseInt(b.slice(8, 10), 10),
  );
  return Math.round((t2 - t1) / 86400000);
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const wdMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = wdMap[map.weekday ?? ''] ?? 0;
  return {
    year: parseInt(map.year ?? '0', 10),
    month: parseInt(map.month ?? '0', 10),
    day: parseInt(map.day ?? '0', 10),
    hour: parseInt(map.hour ?? '0', 10),
    minute: parseInt(map.minute ?? '0', 10),
    weekday,
  };
}

function sameZonedMinute(a: Date, b: Date, timeZone: string): boolean {
  const pa = getZonedParts(a, timeZone);
  const pb = getZonedParts(b, timeZone);
  return (
    pa.year === pb.year
    && pa.month === pb.month
    && pa.day === pb.day
    && pa.hour === pb.hour
    && pa.minute === pb.minute
  );
}

function timeMatchesNow(hm: { h: number; m: number }, parts: ZonedParts): boolean {
  return parts.hour === hm.h && parts.minute === hm.m;
}

function daysInGregorianMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

/**
 * Returns true if this schedule should trigger a run in the current clock minute
 * in the schedule timezone (cron runs once per minute).
 * Uses `lastScheduledRunAt` to avoid double-firing in the same zoned minute.
 */
export function isExecutionScheduleDueThisMinute(
  schedule: ScheduleEvalInput | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule?.enabled || !schedule.type) {
    return false;
  }
  const tz = schedule.timezone && schedule.timezone.trim() ? schedule.timezone : 'UTC';
  if (schedule.lastScheduledRunAt && sameZonedMinute(new Date(schedule.lastScheduledRunAt), now, tz)) {
    return false;
  }

  const parts = getZonedParts(now, tz);

  switch (schedule.type) {
    case 'daily': {
      const times = schedule.daily?.timesLocal ?? [];
      for (const t of times) {
        const hm = parseHm(t);
        if (hm && timeMatchesNow(hm, parts)) return true;
      }
      return false;
    }
    case 'weekly': {
      for (const slot of schedule.weekly?.slots ?? []) {
        const hm = parseHm(slot.timeLocal);
        if (hm && slot.weekday === parts.weekday && timeMatchesNow(hm, parts)) return true;
      }
      return false;
    }
    case 'monthly': {
      const dim = daysInGregorianMonth(parts.year, parts.month);
      for (const slot of schedule.monthly?.slots ?? []) {
        const hm = parseHm(slot.timeLocal);
        if (!hm) continue;
        let dayOk = false;
        if (slot.dayOfMonth === -1) {
          dayOk = parts.day === dim;
        } else {
          dayOk = slot.dayOfMonth === parts.day;
        }
        if (dayOk && timeMatchesNow(hm, parts)) return true;
      }
      return false;
    }
    case 'advanced': {
      const adv = schedule.advanced;
      if (!adv?.variant) return false;
      const hm = adv.timeLocal ? parseHm(adv.timeLocal) : null;
      if (!hm || !timeMatchesNow(hm, parts)) return false;

      if (adv.variant === 'weekdays') {
        return parts.weekday >= 1 && parts.weekday <= 5;
      }
      if (adv.variant === 'weekend') {
        return parts.weekday === 0 || parts.weekday === 6;
      }
      if (adv.variant === 'every_n_days') {
        const interval = Math.max(1, adv.intervalDays ?? 1);
        const last = schedule.lastScheduledRunAt ? new Date(schedule.lastScheduledRunAt) : null;
        if (!last) {
          return true;
        }
        const d0 = zonedYmd(last, tz);
        const d1 = zonedYmd(now, tz);
        return daysBetweenYmd(d0, d1) >= interval;
      }
      return false;
    }
    default:
      return false;
  }
}
