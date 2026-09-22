/**
 * Escape a user-supplied fragment for use inside a LIKE/ILIKE pattern.
 * PostgreSQL's default escape character is the backslash.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
