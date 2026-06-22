const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_MAP: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const zonedPartsCache = new Map<string, Intl.DateTimeFormat>();
const ymdCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = zonedPartsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric',
    });
    zonedPartsCache.set(timeZone, fmt);
  }
  return fmt;
}

function getYmdFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ymdCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    ymdCache.set(timeZone, fmt);
  }
  return fmt;
}

function parseHm(s: string): { h: number; m: number } | null {
  const m = s.trim().match(HM);
  if (!m) return null;
  return { h: Number.parseInt(m[1], 10), m: Number.parseInt(m[2], 10) };
}

export function zonedYmd(date: Date, timeZone: string): string {
  return getYmdFormatter(timeZone).format(date);
}

export function daysBetweenYmd(a: string, b: string): number {
  const parseYmd = (s: string) => {
    const y = Number.parseInt(s.slice(0, 4), 10);
    const m = Number.parseInt(s.slice(5, 7), 10) - 1;
    const d = Number.parseInt(s.slice(8, 10), 10);
    return Date.UTC(y, m, d);
  };
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

type ZonedParts = {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = getZonedFormatter(timeZone);
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekday = WEEKDAY_MAP[map.weekday ?? ''] ?? 0;
  return {
    year: Number.parseInt(map.year ?? '0', 10),
    month: Number.parseInt(map.month ?? '0', 10),
    day: Number.parseInt(map.day ?? '0', 10),
    hour: Number.parseInt(map.hour ?? '0', 10),
    minute: Number.parseInt(map.minute ?? '0', 10),
    weekday,
  };
}

function sameZonedMinute(a: Date, b: Date, timeZone: string): boolean {
  const pa = getZonedParts(a, timeZone);
  const pb = getZonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
    && pa.hour === pb.hour && pa.minute === pb.minute;
}

function timeMatchesNow(hm: { h: number; m: number }, parts: ZonedParts): boolean {
  return parts.hour === hm.h && parts.minute === hm.m;
}

function daysInGregorianMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

export function weekOfMonthFromCalendarDay(dayOfMonth: number): number {
  return Math.min(5, Math.ceil(dayOfMonth / 7));
}

export type FlowScheduleEvalInput = {
  enabled?: boolean;
  timezone?: string;
  scheduleType?: string;
  lastScheduledRunAt?: Date | null;
  daily?: { timesLocal?: string[] } | null;
  weekly?: { slots?: Array<{ weekday: number; timeLocal: string }> } | null;
  monthly?: {
    slots?: Array<{ monthOfYear?: number | null; dayOfMonth: number; timeLocal: string }>;
  } | null;
  advanced?: {
    variant: 'weekdays' | 'weekend' | 'every_n_days';
    intervalDays?: number | null;
    timeLocal?: string | null;
    monthOfYear?: number | null;
    weekOfMonth?: number | null;
  } | null;
};

export function isFlowScheduleDueThisMinute(
  schedule: FlowScheduleEvalInput | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule?.enabled || !schedule.scheduleType) return false;

  const tz = schedule.timezone?.trim() || 'UTC';
  if (schedule.lastScheduledRunAt && sameZonedMinute(new Date(schedule.lastScheduledRunAt), now, tz)) {
    return false;
  }

  const parts = getZonedParts(now, tz);
  const st = schedule.scheduleType;

  if (st === 'daily') {
    for (const t of schedule.daily?.timesLocal ?? []) {
      const hm = parseHm(t);
      if (hm && timeMatchesNow(hm, parts)) return true;
    }
    return false;
  }
  if (st === 'weekly') {
    for (const slot of schedule.weekly?.slots ?? []) {
      const hm = parseHm(slot.timeLocal);
      if (hm && slot.weekday === parts.weekday && timeMatchesNow(hm, parts)) return true;
    }
    return false;
  }
  if (st === 'monthly') {
    const dim = daysInGregorianMonth(parts.year, parts.month);
    for (const slot of schedule.monthly?.slots ?? []) {
      const hm = parseHm(slot.timeLocal);
      if (!hm) continue;
      if (slot.monthOfYear != null && slot.monthOfYear !== parts.month) continue;
      let dayOk = slot.dayOfMonth === 0
        || (slot.dayOfMonth === -1 ? parts.day === dim : slot.dayOfMonth === parts.day);
      if (dayOk && timeMatchesNow(hm, parts)) return true;
    }
    return false;
  }
  if (st === 'advanced') {
    const adv = schedule.advanced;
    if (!adv?.variant || !adv.timeLocal) return false;
    const hm = parseHm(adv.timeLocal);
    if (!hm || !timeMatchesNow(hm, parts)) return false;
    if (adv.variant === 'weekdays') return parts.weekday >= 1 && parts.weekday <= 5;
    if (adv.variant === 'weekend') {
      if (parts.weekday !== 0 && parts.weekday !== 6) return false;
      if (adv.monthOfYear != null && adv.monthOfYear !== parts.month) return false;
      if (adv.weekOfMonth != null) {
        if (weekOfMonthFromCalendarDay(parts.day) !== adv.weekOfMonth) return false;
      }
      return true;
    }
    if (adv.variant === 'every_n_days') {
      const interval = Math.max(1, adv.intervalDays ?? 1);
      const last = schedule.lastScheduledRunAt ? new Date(schedule.lastScheduledRunAt) : null;
      if (!last) return true;
      return daysBetweenYmd(zonedYmd(last, tz), zonedYmd(now, tz)) >= interval;
    }
  }
  return false;
}

export const shouldRunFlowSchedule = isFlowScheduleDueThisMinute;
