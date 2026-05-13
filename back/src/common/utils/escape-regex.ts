/**
 * Escapes special regex characters in a string to prevent ReDoS attacks
 * when using user input in MongoDB $regex queries.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in regex patterns
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
