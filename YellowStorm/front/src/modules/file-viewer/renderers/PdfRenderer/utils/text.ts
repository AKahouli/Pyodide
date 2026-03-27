/**
 * Text-related helpers for the headless PDF renderer.
 * Keep string parsing logic here to keep components lean.
 */

const OPEN_TAG_PATTERN = /^<page\s+number=(\d+)>/i;
const CLOSE_TAG_PATTERN = /<\/page>$/i;

/**
 * Remove <page number=...> ... </page> markers and return the remaining text.
 */
export function extractHighlightText(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }

  let working = raw.trim();

  const openMatch = OPEN_TAG_PATTERN.exec(working);
  if (openMatch) {
    working = working.slice(openMatch[0].length);
  }

  const closeMatch = CLOSE_TAG_PATTERN.exec(working);
  if (closeMatch) {
    working = working.slice(0, working.length - closeMatch[0].length);
  }

  const text = working.trim().replaceAll(/\s+/g, ' ');
  return text.length > 0 ? text : undefined;
}
