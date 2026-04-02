import type {
  AdvancedSchedulePayloadData,
  AdvancedScheduleVariant,
  DailySchedulePayloadData,
  ExecutionScheduleData,
  ExecutionScheduleType,
  MonthlySchedulePayloadData,
  WeeklySchedulePayloadData,
} from '../interfaces/playbook.interface';

const SCHEDULE_TYPES = new Set<ExecutionScheduleType>(['daily', 'weekly', 'monthly', 'advanced']);

const ADVANCED_VARIANTS = new Set<AdvancedScheduleVariant>(['weekdays', 'weekend', 'every_n_days']);

function parseScheduleType(value: unknown): ExecutionScheduleType | undefined {
  return typeof value === 'string' && SCHEDULE_TYPES.has(value as ExecutionScheduleType)
    ? (value as ExecutionScheduleType)
    : undefined;
}

function parseAdvancedVariant(value: unknown): AdvancedScheduleVariant {
  return typeof value === 'string' && ADVANCED_VARIANTS.has(value as AdvancedScheduleVariant)
    ? (value as AdvancedScheduleVariant)
    : 'weekdays';
}

/** Normalise Mongo / lean date fields to ISO strings; invalid values become null. */
function toIsoStringOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  const d = new Date(value as number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapDaily(raw: unknown): DailySchedulePayloadData | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  const times = o.timesLocal;
  const timesLocal = Array.isArray(times) ? times.map((t) => String(t)) : [];
  return { timesLocal };
}

function mapWeeklySlots(raw: unknown): WeeklySchedulePayloadData['slots'] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const slot = asRecord(item) ?? {};
    return {
      weekday: Number(slot.weekday),
      timeLocal: String(slot.timeLocal ?? ''),
    };
  });
}

function mapWeekly(raw: unknown): WeeklySchedulePayloadData | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  return { slots: mapWeeklySlots(o.slots) };
}

function mapMonthlySlots(raw: unknown): MonthlySchedulePayloadData['slots'] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const slot = asRecord(item) ?? {};
    const moy = slot.monthOfYear;
    const moyN = moy === null || moy === undefined ? NaN : Number(moy);
    return {
      monthOfYear: Number.isFinite(moyN) ? moyN : null,
      dayOfMonth: Number(slot.dayOfMonth),
      timeLocal: String(slot.timeLocal ?? ''),
    };
  });
}

function mapMonthly(raw: unknown): MonthlySchedulePayloadData | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  return { slots: mapMonthlySlots(o.slots) };
}

function parseOptionalMonthWeek(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapAdvanced(raw: unknown): AdvancedSchedulePayloadData | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  const interval = o.intervalDays;
  const time = o.timeLocal;
  return {
    variant: parseAdvancedVariant(o.variant),
    intervalDays: interval === null || interval === undefined ? null : Number(interval),
    timeLocal: time === null || time === undefined ? null : String(time),
    monthOfYear: parseOptionalMonthWeek(o.monthOfYear),
    weekOfMonth: parseOptionalMonthWeek(o.weekOfMonth),
  };
}

/**
 * Maps a persisted `executionSchedule` subdocument (Mongoose document or lean object) to the API DTO.
 * Tolerates partial / legacy shapes without throwing.
 */
export function mapExecutionScheduleToData(sched: unknown): ExecutionScheduleData | null {
  if (sched == null || typeof sched !== 'object' || Array.isArray(sched)) {
    return null;
  }
  const s = sched as Record<string, unknown>;

  return {
    enabled: Boolean(s.enabled),
    timezone: typeof s.timezone === 'string' && s.timezone.length > 0 ? s.timezone : 'UTC',
    type: parseScheduleType(s.type),
    lastScheduledRunAt: toIsoStringOrNull(s.lastScheduledRunAt),
    daily: mapDaily(s.daily),
    weekly: mapWeekly(s.weekly),
    monthly: mapMonthly(s.monthly),
    advanced: mapAdvanced(s.advanced),
  };
}
