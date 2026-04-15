/** Used only if `Intl` does not report a timezone (very rare). */
const FALLBACK_SCHEDULE_TIMEZONE = 'UTC';

/**
 * IANA timezone for schedule upserts when the UI does not expose a timezone control.
 * Uses the browser's current timezone (same source as the user's local clock).
 */
export function getDefaultScheduleTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz.trim()) {
      return tz.trim();
    }
  } catch {
    // ignore
  }
  return FALLBACK_SCHEDULE_TIMEZONE;
}
