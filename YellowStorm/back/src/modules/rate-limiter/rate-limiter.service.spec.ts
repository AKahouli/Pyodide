import { RateLimiterService } from './rate-limiter.service';
import { MemoryStore } from './stores/memory.store';
import { ConfigService } from '@nestjs/config';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue: number) => {
        if (key === 'app.throttleLimit') return 5;
        if (key === 'app.throttleTtl') return 60; // seconds
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new RateLimiterService(mockConfigService, store);
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  describe('check', () => {
    it('should allow requests under the limit', async () => {
      const result = await service.check('user:1:GET:test');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
    });

    it('should decrement remaining on each call', async () => {
      await service.check('user:1:GET:test');
      await service.check('user:1:GET:test');
      const result = await service.check('user:1:GET:test');

      expect(result.remaining).toBe(2);
    });

    it('should deny requests over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await service.check('user:1:GET:test');
      }

      const result = await service.check('user:1:GET:test');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should include retryAfter when denied', async () => {
      for (let i = 0; i < 5; i++) {
        await service.check('user:1:GET:test');
      }

      const result = await service.check('user:1:GET:test');

      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should not include retryAfter when allowed', async () => {
      const result = await service.check('user:1:GET:test');

      expect(result.retryAfter).toBeUndefined();
    });

    it('should use custom limit from options', async () => {
      const result = await service.check('user:1:GET:test', { limit: 3 });

      expect(result.limit).toBe(3);
      expect(result.remaining).toBe(2);
    });

    it('should use custom windowMs from options', async () => {
      jest.useFakeTimers();

      await service.check('user:1:GET:test', { limit: 1, windowMs: 2000 });
      let result = await service.check('user:1:GET:test', { limit: 1, windowMs: 2000 });
      expect(result.allowed).toBe(false);

      jest.advanceTimersByTime(3000);

      result = await service.check('user:1:GET:test', { limit: 1, windowMs: 2000 });
      expect(result.allowed).toBe(true);

      jest.useRealTimers();
    });

    it('should use custom keyPrefix from options', async () => {
      await service.check('user:1', { keyPrefix: 'custom' });

      // Different prefix = different counter
      const result = await service.check('user:1', { keyPrefix: 'other' });

      expect(result.remaining).toBe(4); // fresh counter
    });

    it('should use default keyPrefix "rl" when not specified', async () => {
      await service.check('user:1');

      // Same default prefix = same counter
      const result = await service.check('user:1');

      expect(result.remaining).toBe(3);
    });

    it('should track different identifiers separately', async () => {
      await service.check('user:1:GET:test');
      await service.check('user:1:GET:test');
      await service.check('user:2:GET:test');

      const r1 = await service.check('user:1:GET:test');
      const r2 = await service.check('user:2:GET:test');

      expect(r1.remaining).toBe(2); // 4th call
      expect(r2.remaining).toBe(3); // 2nd call
    });
  });

  describe('reset', () => {
    it('should reset the counter for an identifier', async () => {
      await service.check('user:1');
      await service.check('user:1');
      await service.check('user:1');

      await service.reset('user:1');

      const result = await service.check('user:1');

      expect(result.remaining).toBe(4); // back to fresh
    });

    it('should not affect other identifiers', async () => {
      await service.check('user:1');
      await service.check('user:2');

      await service.reset('user:1');

      const result = await service.check('user:2');

      expect(result.remaining).toBe(3); // not reset
    });

    it('should use custom keyPrefix', async () => {
      await service.check('user:1', { keyPrefix: 'api' });
      await service.check('user:1', { keyPrefix: 'api' });

      await service.reset('user:1', 'api');

      // Verify the "api" prefix counter was reset
      const result = await service.check('user:1', { keyPrefix: 'api' });

      expect(result.remaining).toBe(4);
    });
  });

  describe('getStatus', () => {
    it('should return full limit when no record exists', async () => {
      const result = await service.getStatus('user:1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.limit).toBe(5);
    });

    it('should return current status without incrementing', async () => {
      await service.check('user:1');
      await service.check('user:1');

      const status = await service.getStatus('user:1');

      expect(status.remaining).toBe(3);

      // Verify getStatus didn't increment
      const status2 = await service.getStatus('user:1');

      expect(status2.remaining).toBe(3);
    });

    it('should report not allowed when at limit', async () => {
      for (let i = 0; i < 5; i++) {
        await service.check('user:1');
      }

      const status = await service.getStatus('user:1');

      expect(status.allowed).toBe(false);
      expect(status.remaining).toBe(0);
    });

    it('should use custom options', async () => {
      await service.check('user:1', { limit: 2, keyPrefix: 'custom' });

      const status = await service.getStatus('user:1', {
        limit: 2,
        keyPrefix: 'custom',
      });

      expect(status.limit).toBe(2);
      expect(status.remaining).toBe(1);
    });
  });

  describe('generateKey', () => {
    it('should generate user-based key with endpoint', () => {
      const key = service.generateKey('user-42', '127.0.0.1', 'GET:/api/test');

      expect(key).toBe('user:user-42:GET::api:test');
    });

    it('should generate user-based key without endpoint', () => {
      const key = service.generateKey('user-42');

      expect(key).toBe('user:user-42');
    });

    it('should fallback to IP when no userId', () => {
      const key = service.generateKey(undefined, '192.168.1.1', 'POST:/api/data');

      expect(key).toBe('ip:192.168.1.1:POST::api:data');
    });

    it('should fallback to IP without endpoint', () => {
      const key = service.generateKey(undefined, '10.0.0.1');

      expect(key).toBe('ip:10.0.0.1');
    });

    it('should prefer userId over IP', () => {
      const key = service.generateKey('user-1', '127.0.0.1');

      expect(key).toBe('user:user-1');
    });

    it('should return "anonymous" when no userId or IP', () => {
      const key = service.generateKey();

      expect(key).toBe('anonymous');
    });

    it('should return "anonymous" with endpoint when no userId or IP', () => {
      const key = service.generateKey(undefined, undefined, 'GET:/health');

      expect(key).toBe('anonymous:GET::health');
    });

    it('should replace slashes with colons in endpoint', () => {
      const key = service.generateKey('u1', undefined, '/api/v1/users/123');

      expect(key).toBe('user:u1::api:v1:users:123');
    });
  });
});
