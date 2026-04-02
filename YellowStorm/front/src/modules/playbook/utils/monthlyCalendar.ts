/**
 * Number of days in a calendar month (1–12) for a given year (leap years handled for February).
 */
export function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Max day index for the picker.
 * “Every month” (no fixed month): 1–31 — months without that calendar day never match (same as backend).
 * Fixed month: real length (28–31), leap years for February.
 */
export function maxDayForMonthlySlot(monthOfYear: number | null | undefined, year: number): number {
  if (monthOfYear == null) {
    return 31;
  }
  return daysInCalendarMonth(year, monthOfYear);
}

/** Clamp day to valid range; `-1` = last day of month; `0` = every day (unchanged). */
export function clampMonthlyDay(
  dayOfMonth: number,
  monthOfYear: number | null | undefined,
  year: number,
): number {
  if (dayOfMonth === -1) {
    return -1;
  }
  if (dayOfMonth === 0) {
    return 0;
  }
  const max = maxDayForMonthlySlot(monthOfYear, year);
  return Math.min(Math.max(1, dayOfMonth), max);
}
