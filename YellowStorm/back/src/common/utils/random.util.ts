import { randomInt } from 'node:crypto';

/**
 * Returns a multiplicative jitter factor in [0.9, 1.1) for exponential backoff.
 * Uses a CSPRNG instead of Math.random() for static-analysis compliance.
 */
export function randomBackoffJitter(): number {
  return randomInt(900, 1100) / 1000;
}
