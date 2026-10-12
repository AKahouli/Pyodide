import { LoginLockedException, LoginLockoutService } from './login-lockout.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';

describe('LoginLockoutService', () => {
  const makeConfig = (accountLimit = 6) =>
    ({
      lockout: { threshold: 3, baseSeconds: 30, maxSeconds: 120, resetSeconds: 600 },
      rateLimits: { account: { login: { limit: accountLimit, windowMs: 900_000 } } },
    }) as unknown as ConstructorParameters<typeof LoginLockoutService>[0];

  const IP = '203.0.113.7';
  const OTHER_IP = '198.51.100.9';

  let service: LoginLockoutService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new LoginLockoutService(makeConfig());
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  const fail = (email: string, ip = IP, times = 1) => {
    let last: number | null = null;
    for (let i = 0; i < times; i++) last = service.reserveAttempt(email, ip);
    return last;
  };

  it('does not lock before the threshold', () => {
    expect(fail('a@x.io', IP, 2)).toBeNull();
    expect(() => { service.assertNotLocked('a@x.io', IP); }).not.toThrow();
  });

  it('locks the IP+email pair at the threshold and unlocks when the delay elapses', () => {
    expect(fail('a@x.io', IP, 3)).toBe(30);

    expect(() => { service.assertNotLocked('A@x.io ', IP); }).toThrow(LoginLockedException);
    let thrown: unknown;
    try {
      service.assertNotLocked('a@x.io', IP);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS, retryAfterSeconds: 30 });

    jest.advanceTimersByTime(30_001);
    expect(() => { service.assertNotLocked('a@x.io', IP); }).not.toThrow();
  });

  it('does not lock the same email for other IPs (victim cannot be locked out by an attacker)', () => {
    fail('a@x.io', IP, 3);

    expect(() => { service.assertNotLocked('a@x.io', OTHER_IP); }).not.toThrow();
    expect(() => { service.assertNotLocked('b@x.io', IP); }).not.toThrow();
  });

  it('doubles the delay per further failure up to the cap', () => {
    fail('a@x.io', IP, 2);
    expect(fail('a@x.io')).toBe(30);
    expect(fail('a@x.io')).toBe(60);
    expect(fail('a@x.io')).toBe(120);
    expect(fail('a@x.io')).toBe(120);
  });

  it('clears the pair streak and the email budget on success', () => {
    fail('a@x.io', IP, 3);
    service.recordSuccess('a@x.io', IP);

    expect(() => { service.assertNotLocked('a@x.io', IP); }).not.toThrow();
    expect(service.reserveAttempt('a@x.io', IP)).toBeNull();
  });

  it('release undoes a reservation', () => {
    fail('a@x.io', IP, 2);
    service.release('a@x.io', IP);
    service.release('a@x.io', IP);

    expect(fail('a@x.io', IP, 2)).toBeNull();
  });

  it('forgets an old streak after the quiet period', () => {
    fail('a@x.io', IP, 2);
    jest.advanceTimersByTime(601_000);

    expect(service.reserveAttempt('a@x.io', IP)).toBeNull();
  });

  it('applies a cross-IP brake on failed attempts per email and releases it after the window', () => {
    // 6 failures spread over distinct IPs: no pair reaches the threshold, the email budget does.
    for (let i = 0; i < 6; i++) service.reserveAttempt('a@x.io', `192.0.2.${String(i)}`);

    expect(() => { service.assertNotLocked('a@x.io', '192.0.2.200'); }).toThrow(LoginLockedException);
    expect(() => { service.assertNotLocked('b@x.io', '192.0.2.200'); }).not.toThrow();

    jest.advanceTimersByTime(900_001);
    expect(() => { service.assertNotLocked('a@x.io', '192.0.2.200'); }).not.toThrow();
  });

  it('tracks unknown and known emails identically', () => {
    fail('ghost@x.io', IP, 3);

    expect(() => { service.assertNotLocked('ghost@x.io', IP); }).toThrow();
    expect(() => { service.assertNotLocked('real@x.io', IP); }).not.toThrow();
  });

  describe('capacity', () => {
    const fillWithLocks = (count: number) => {
      for (let i = 0; i < count; i++) fail(`user${String(i)}@x.io`, IP, 3);
    };

    it('never evicts an active lock when full; the new record is dropped instead', () => {
      const pairs = (service as unknown as { pairs: Map<string, unknown> }).pairs;
      // Shrink the cap by filling the real map with 50k active locks cheaply.
      const lockedUntil = Date.now() + 3_600_000;
      for (let i = 0; i < 50_000; i++) {
        pairs.set(`k${String(i)}`, { failures: 9, lockedUntil, lastFailureAt: Date.now() });
      }

      fail('newcomer@x.io', IP, 3);

      expect(pairs.size).toBe(50_000);
      expect(pairs.has('k0')).toBe(true);
      expect(() => { service.assertNotLocked('newcomer@x.io', IP); }).not.toThrow();
    });

    it('evicts an unlocked/expired entry first when full', () => {
      const pairs = (service as unknown as { pairs: Map<string, unknown> }).pairs;
      const lockedUntil = Date.now() + 3_600_000;
      pairs.set('stale', { failures: 1, lockedUntil: 0, lastFailureAt: Date.now() });
      for (let i = 0; i < 49_999; i++) {
        pairs.set(`k${String(i)}`, { failures: 9, lockedUntil, lastFailureAt: Date.now() });
      }

      fail('newcomer@x.io', IP, 3);

      expect(pairs.has('stale')).toBe(false);
      expect(pairs.size).toBe(50_000);
      expect(() => { service.assertNotLocked('newcomer@x.io', IP); }).toThrow(LoginLockedException);
    });

    it('is not needed for small populations', () => {
      fillWithLocks(3);
      expect(() => { service.assertNotLocked('user0@x.io', IP); }).toThrow();
    });
  });
});
