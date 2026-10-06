import { BUDGETS, REDACTION, isSensitiveKey } from './contract';

const REDACTED = REDACTION.redacted_marker;

/** Credentials embedded in URLs (userinfo) and connection DSNs. Bounded regexes, applied per string. */
const URL_USERINFO = /(?:https?|wss?|postgres(?:ql)?|redis|mongodb(?:\+srv)?|amqps?):\/\/[^\s/@]+:[^\s/@]+@/g;
const DSN = /\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?|mysql):\/\/[^\s]+/g;
const BEARER = /\bBearer\s+[\w.~\-+/]+=*/gi;

export function scrubText(value: string): string {
  return value.replace(URL_USERINFO, (m) => `${m.slice(0, m.indexOf(':') + 1)}//[REDACTED]@`)
    .replace(DSN, (m) => `${m.slice(0, m.indexOf(':') + 1)}//[REDACTED]`)
    .replace(BEARER, 'Bearer [REDACTED]');
}

/** UTF-8 byte-bounded truncation; never produces invalid partial JSON (operates on decoded strings). */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo);
}

export function sanitizeKey(key: string, out: Record<string, unknown>): boolean {
  if (isSensitiveKey(key)) {
    out[key] = REDACTED;
    return true;
  }
  return false;
}

/** Strip local absolute paths from stack text; keep filename/function/line references. */
export function sanitizeStack(stack: string): string {
  const cwd = process.cwd();
  let out = stack;
  if (cwd && cwd !== '/') out = out.split(cwd + '\\').join('').split(cwd + '/').join('');
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) out = out.split(home).join('~');
  return out;
}

/** Keep the first N frames / bytes of a stack, whichever bound hits first. */
export function boundStack(stack: string, maxBytes = BUDGETS.max_error_stack_bytes, maxFrames = BUDGETS.max_error_stack_frames): string {
  const lines = sanitizeStack(stack).split('\n').slice(0, maxFrames + 1);
  let out = '';
  for (const line of lines) {
    if (Buffer.byteLength(out) + Buffer.byteLength(line) + 1 > maxBytes) break;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

/**
 * Legacy adapter helper: bounded, redacted JSON summary of an arbitrary legacy data object.
 * Depth-capped, cycle-safe, sensitive keys redacted, output byte-capped. Never throws.
 */
export function boundedDetail(value: unknown, maxBytes = BUDGETS.max_attribute_string_bytes, maxDepth = 5): string | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === undefined || v === null || typeof v === 'boolean') return v ?? null;
    if (isFiniteNumber2(v)) return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string') return truncateUtf8(scrubText(v), 256);
    if (typeof v !== 'object' && typeof v !== 'function') return String(v);
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (seen.has(v)) return '[Circular]';
    if (depth >= maxDepth) return '[MAX_DEPTH]';
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.slice(0, 16).map((item) => walk(item, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
        out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth + 1);
      }
      return out;
    } finally {
      seen.delete(v);
    }
  };
  try {
    return truncateUtf8(JSON.stringify(walk(value, 0)) ?? '', maxBytes);
  } catch {
    return undefined;
  }
}

function isFiniteNumber2(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
