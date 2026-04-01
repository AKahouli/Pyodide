/**
 * Client-side validation for PUT /playbooks/:id/schedule.
 * Types are inlined here to avoid circular imports with `types.ts` (Vite can then omit the named export at runtime).
 */
export type UpsertScheduleValidationInput = {
  enabled: boolean;
  timezone?: string;
  type?: 'daily' | 'weekly' | 'monthly' | 'advanced';
  daily?: { timesLocal: string[] };
  weekly?: { slots: { weekday: number; timeLocal: string }[] };
  monthly?: { slots: { dayOfMonth: number; timeLocal: string }[] };
  advanced?: {
    variant: 'weekdays' | 'weekend' | 'every_n_days';
    intervalDays: number | null;
    timeLocal: string | null;
  };
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Returns an error message key (for i18n) or null when valid. */
export function validateUpsertSchedulePayload(d: UpsertScheduleValidationInput): string | null {
  if (!d.enabled) {
    return null;
  }
  if (!d.timezone?.trim()) {
    return 'schedule.validation.timezone';
  }
  if (!d.type) {
    return 'schedule.validation.type';
  }
  switch (d.type) {
    case 'daily': {
      const times = d.daily?.timesLocal ?? [];
      if (times.length < 1) return 'schedule.validation.times';
      for (const t of times) {
        if (!TIME_RE.test(t)) return 'schedule.validation.timeFormat';
      }
      break;
    }
    case 'weekly': {
      const slots = d.weekly?.slots ?? [];
      if (slots.length < 1) return 'schedule.validation.slots';
      for (const s of slots) {
        if (s.weekday < 0 || s.weekday > 6) return 'schedule.validation.weekday';
        if (!TIME_RE.test(s.timeLocal)) return 'schedule.validation.timeFormat';
      }
      break;
    }
    case 'monthly': {
      const slots = d.monthly?.slots ?? [];
      if (slots.length < 1) return 'schedule.validation.slots';
      for (const s of slots) {
        if (s.dayOfMonth !== -1 && (s.dayOfMonth < 1 || s.dayOfMonth > 31)) {
          return 'schedule.validation.dayOfMonth';
        }
        if (!TIME_RE.test(s.timeLocal)) return 'schedule.validation.timeFormat';
      }
      break;
    }
    case 'advanced': {
      const adv = d.advanced;
      if (!adv) return 'schedule.validation.advanced';
      if (adv.variant === 'every_n_days') {
        const n = adv.intervalDays;
        if (n == null || n < 1 || n > 366) return 'schedule.validation.interval';
        if (!adv.timeLocal || !TIME_RE.test(adv.timeLocal)) return 'schedule.validation.timeFormat';
      } else {
        if (!adv.timeLocal || !TIME_RE.test(adv.timeLocal)) return 'schedule.validation.timeFormat';
      }
      break;
    }
    default:
      return 'schedule.validation.type';
  }
  return null;
}
