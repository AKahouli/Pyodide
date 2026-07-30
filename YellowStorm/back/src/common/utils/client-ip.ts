import type { Request } from 'express';

/**
 * Client IP for rate limiting / audit, using Express's resolved `req.ip`.
 *
 * Do NOT read X-Forwarded-For / X-Real-IP here — those headers are
 * attacker-controlled unless Express `trust proxy` is set to trusted
 * hop counts or CIDRs (see main.ts + TRUST_PROXY). With trust proxy
 * configured, Express derives `req.ip` safely; without it, `req.ip` is
 * the socket peer and spoofed forwarding headers are ignored.
 */
export function getClientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

/**
 * Parse TRUST_PROXY for Express `app.set('trust proxy', ...)`.
 *
 * - unset / empty / `false` / `0` → false (ignore forwarding headers)
 * - integer → trust that many proxy hops
 * - `true` → trust all (not recommended)
 * - comma-separated CIDRs / named ranges (e.g. `loopback,10.0.0.0/8`) → array
 * - single CIDR or name → string
 */
export function parseTrustProxySetting(
  raw: string | undefined,
): boolean | number | string | string[] {
  const value = (raw ?? '').trim();
  if (!value || value === 'false' || value === '0') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (value.includes(',')) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return value;
}
