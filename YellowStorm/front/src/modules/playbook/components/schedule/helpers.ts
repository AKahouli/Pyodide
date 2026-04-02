import type { ExecutionScheduleData, UpsertPlaybookScheduleData } from '../../types';
import { clampMonthlyDay } from '../../utils/monthlyCalendar';

export function defaultSchedule(): UpsertPlaybookScheduleData {
  return {
    enabled: true,
    type: 'daily',
    daily: { timesLocal: ['09:00'] },
  };
}

export function fromExecutionSchedule(s: ExecutionScheduleData | null): UpsertPlaybookScheduleData {
  if (!s || !s.enabled || !s.type) {
    return defaultSchedule();
  }
  const base: UpsertPlaybookScheduleData = {
    enabled: true,
    type: s.type,
  };
  if (s.type === 'daily' && s.daily) {
    base.daily = { timesLocal: [...s.daily.timesLocal] };
  } else if (s.type === 'weekly' && s.weekly) {
    base.weekly = { slots: s.weekly.slots.map((x) => ({ ...x })) };
  } else if (s.type === 'monthly' && s.monthly) {
    const y = new Date().getFullYear();
    base.monthly = {
      slots: s.monthly.slots.map((x) => ({
        monthOfYear: x.monthOfYear ?? null,
        dayOfMonth: clampMonthlyDay(x.dayOfMonth, x.monthOfYear ?? null, y),
        timeLocal: x.timeLocal,
      })),
    };
  } else if (s.type === 'advanced' && s.advanced) {
    const adv = s.advanced;
    const variant =
      adv.variant === 'every_n_days' ? 'weekdays' : adv.variant;
    base.advanced = {
      variant,
      intervalDays: null,
      timeLocal: adv.timeLocal ?? null,
      monthOfYear: adv.monthOfYear ?? null,
      weekOfMonth: adv.weekOfMonth ?? null,
    };
  } else {
    base.type = 'daily';
    base.daily = { timesLocal: ['09:00'] };
  }
  return base;
}
