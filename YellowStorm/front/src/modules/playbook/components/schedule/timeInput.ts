/** Normalize `<input type="time">` value to `HH:mm` for API validation. */
export function timeLocalFromInput(value: string): string {
  if (!value) return '';
  return value.length >= 8 ? value.slice(0, 5) : value;
}
