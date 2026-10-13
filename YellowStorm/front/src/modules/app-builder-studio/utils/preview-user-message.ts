/**
 * Keep Nodepod / preview chrome free of agent-process and platform internals.
 */

const TECHNICAL_RE =
  /VITE_YM_|yellowruntime_|yellowappdata_|mcpToken|aiprev_|Bearer\s|sha256|ECONNREFUSED|ENOENT|CORS|Access-Control|postMessage|ProtectedRoute|stack trace|npm ERR|node_modules/i;

/** True when a string looks like internal/debug output unsuitable for end users. */
export function looksTechnicalPreviewMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (TECHNICAL_RE.test(trimmed)) return true;
  // Long multi-line blobs (stacks) — not short user-facing sentences.
  if (trimmed.length > 280 && /[\n\r]| at |Error:|Exception/.test(trimmed)) return true;
  return false;
}

/**
 * Return a safe user-facing error line, or null when nothing useful should be shown
 * beyond the generic status title.
 */
export function toUserFacingPreviewError(
  raw: string | null | undefined,
  fallback: string,
): string | null {
  if (!raw?.trim()) return null;
  if (looksTechnicalPreviewMessage(raw)) return fallback;
  return raw.trim();
}
