import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import authConfig from '@config/auth.config';
import { TooManyRequestsException } from '../../exceptions';
import { AuthThrottleService } from './auth-throttle.service';

/** 429 raised while a login is locked; carries the delay so the controller can set Retry-After. */
export class LoginLockedException extends TooManyRequestsException {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many failed sign-in attempts. Try again in ${String(retryAfterSeconds)} seconds.`);
  }
}

interface FailureRecord {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

interface AccountBudget {
  failures: number;
  resetAt: number;
}

const CLEANUP_INTERVAL_MS = 60_000;
/** Hard bound per map so a spray of random emails/IPs cannot grow memory without limit. */
const MAX_TRACKED = 50_000;

/**
 * Brute-force protection for password logins, two layers:
 *
 * 1. Progressive lock per (client IP, email): after `threshold` consecutive
 *    failures that pair is locked for `baseSeconds`, doubling per further
 *    failure up to `maxSeconds`. Keyed by the pair so an attacker only locks
 *    themselves out, never the real owner signing in from elsewhere.
 * 2. Cross-IP brake per email: at most `rateLimits.account.login.limit`
 *    FAILED attempts per window across all IPs (distributed guessing).
 *    Successful logins never consume it.
 *
 * Attempts are reserved (counted) before the password comparison so a burst of
 * concurrent requests cannot all pass the check; a valid password clears both
 * counters for that pair/email. Tracked by digest whether or not the account
 * exists, so neither layer reveals real accounts. State is per process, like
 * RateLimiterService.
 */
@Injectable()
export class LoginLockoutService implements OnModuleDestroy {
  private readonly pairs = new Map<string, FailureRecord>();
  private readonly accounts = new Map<string, AccountBudget>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {
    this.cleanupTimer = setInterval(() => { this.cleanup(); }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    this.pairs.clear();
    this.accounts.clear();
  }

  /** Throws a 429 (LoginLockedException) while this IP+email is locked or the email's failure budget is spent. */
  assertNotLocked(email: string, ip: string): void {
    const now = Date.now();

    const pair = this.pairs.get(this.pairKey(email, ip));
    if (pair && pair.lockedUntil > now) {
      throw new LoginLockedException(Math.ceil((pair.lockedUntil - now) / 1000));
    }

    const account = this.accounts.get(AuthThrottleService.digest(email));
    const { limit } = this.config.rateLimits.account.login;
    if (account && account.resetAt > now && account.failures >= limit) {
      throw new LoginLockedException(Math.ceil((account.resetAt - now) / 1000));
    }
  }

  /**
   * Counts a login attempt before the password is compared. Returns the lock
   * duration in seconds when this attempt engaged a lock for the IP+email pair.
   * `recordSuccess` (valid password) or `release` (attempt never decided)
   * undoes the reservation.
   */
  reserveAttempt(email: string, ip: string): number | null {
    const now = Date.now();
    const { threshold, baseSeconds, maxSeconds, resetSeconds } = this.config.lockout;
    const pairKey = this.pairKey(email, ip);

    const existing = this.pairs.get(pairKey);
    const stale = !existing || now - existing.lastFailureAt > resetSeconds * 1000;
    const failures = (stale ? 0 : existing.failures) + 1;

    let lockedUntil = 0;
    let lockSeconds: number | null = null;
    if (failures >= threshold) {
      const exponent = Math.min(failures - threshold, 20);
      lockSeconds = Math.min(maxSeconds, baseSeconds * 2 ** exponent);
      lockedUntil = now + lockSeconds * 1000;
    }
    if (this.hasRoom(this.pairs, pairKey, (r) => r.lockedUntil)) {
      this.pairs.set(pairKey, { failures, lockedUntil, lastFailureAt: now });
    }

    const accountKey = AuthThrottleService.digest(email);
    const budget = this.accounts.get(accountKey);
    if (budget && budget.resetAt > now) {
      budget.failures += 1;
    } else if (this.hasRoom(this.accounts, accountKey, (b) => b.resetAt)) {
      this.accounts.set(accountKey, {
        failures: 1,
        resetAt: now + this.config.rateLimits.account.login.windowMs,
      });
    }
    return lockSeconds;
  }

  /** Valid password: forget the streak for this pair and the email's failure budget. */
  recordSuccess(email: string, ip: string): void {
    this.pairs.delete(this.pairKey(email, ip));
    this.accounts.delete(AuthThrottleService.digest(email));
  }

  /** Undo a reservation when the attempt failed for a reason unrelated to the credentials (e.g. store outage). */
  release(email: string, ip: string): void {
    const pair = this.pairs.get(this.pairKey(email, ip));
    if (pair && pair.failures > 0) {
      pair.failures -= 1;
      if (pair.failures === 0) this.pairs.delete(this.pairKey(email, ip));
    }
    const budget = this.accounts.get(AuthThrottleService.digest(email));
    if (budget && budget.failures > 0) budget.failures -= 1;
  }

  private pairKey(email: string, ip: string): string {
    return `${AuthThrottleService.digest(ip)}:${AuthThrottleService.digest(email)}`;
  }

  /**
   * True when `key` may be stored. At the cap, unlocked/expired entries are
   * evicted first; an active lock is never evicted — if the map is full of
   * them the new record is dropped instead (the per-IP rate limit still
   * bounds that client).
   */
  private hasRoom<V>(map: Map<string, V>, key: string, activeUntil: (value: V) => number): boolean {
    if (map.has(key) || map.size < MAX_TRACKED) return true;
    const now = Date.now();
    for (const [existingKey, value] of map) {
      if (activeUntil(value) <= now) {
        map.delete(existingKey);
        return true;
      }
    }
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    const idleMs = this.config.lockout.resetSeconds * 1000;
    for (const [key, record] of this.pairs) {
      if (record.lockedUntil <= now && now - record.lastFailureAt > idleMs) {
        this.pairs.delete(key);
      }
    }
    for (const [key, budget] of this.accounts) {
      if (budget.resetAt <= now) this.accounts.delete(key);
    }
  }
}
