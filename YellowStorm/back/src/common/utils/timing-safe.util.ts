import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for secrets (API keys, webhook clientStates,
 * shared tokens). Returns false for mismatched lengths or empty input — the
 * length leak is accepted, the byte values are never.
 */
export function timingSafeStringEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = Buffer.from(a ?? '', 'utf8');
  const y = Buffer.from(b ?? '', 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}
