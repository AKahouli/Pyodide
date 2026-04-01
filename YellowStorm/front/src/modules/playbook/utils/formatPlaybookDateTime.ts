/**
 * Format ISO timestamps for playbook UI with optional IANA timezone (defaults to browser local).
 */
export function formatPlaybookDateTime(
  iso: string | null | undefined,
  options?: { timeZone?: string; dateStyle?: 'short' | 'medium'; timeStyle?: 'short' | 'medium' },
): string {
  if (!iso) return '—';
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return '—';
  const date = new Date(d);
  const { timeZone, dateStyle = 'short', timeStyle = 'short' } = options || {};
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle,
      timeStyle,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
