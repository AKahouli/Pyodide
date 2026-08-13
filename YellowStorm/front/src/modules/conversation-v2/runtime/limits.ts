/**
 * Bounds mirroring the APImanus Runtime MCP contract.
 * Sources: runtime_tools/handlers.py and runtime_mcp/schemas.py.
 */

/** `write.content` and `apply_patch.patch` ceiling (handlers.py `_MAX_FILE_SIZE`). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** `SearchMatch.excerpt` is `line.strip()[:200]` in the reference adapter. */
export const SEARCH_EXCERPT_CHARS = 200;
export const SEARCH_MAX_RESULTS_DEFAULT = 50;
export const SEARCH_MAX_RESULTS = 200;

export const LIST_DEPTH_DEFAULT = 2;
export const LIST_MIN_DEPTH = 1;
export const LIST_MAX_DEPTH = 10;

export const RUN_TIMEOUT_DEFAULT = 180_000;
export const RUN_TIMEOUT_MIN = 1_000;
export const RUN_TIMEOUT_MAX = 600_000;

/**
 * Bounded stdout/stderr per MVP 8.6. Nodepod itself truncates at 4 MiB; we cut
 * earlier so a runaway build cannot blow up the Socket.IO frame.
 */
export const RUN_OUTPUT_MAX_BYTES = 1024 * 1024;

/** Directories never walked by `list` / `search`. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
]);

/** Compact DOM outline bounds for `preview_inspect`. */
export const DOM_SUMMARY_MAX_DEPTH = 6;
export const DOM_SUMMARY_MAX_NODES = 200;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Keeps the tail of an oversized log, which is where build failures live.
 * Returns the original string untouched when it already fits.
 */
export function boundOutput(
  text: string,
  maxBytes = RUN_OUTPUT_MAX_BYTES,
): { text: string; truncated: boolean } {
  if (text.length <= maxBytes) return { text, truncated: false };
  return { text: text.slice(text.length - maxBytes), truncated: true };
}
