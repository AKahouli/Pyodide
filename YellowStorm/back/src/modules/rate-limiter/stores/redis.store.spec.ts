import { RedisStore } from './redis.store';
import { ConfigService } from '@nestjs/config';

const mockRedis = {
  incr: jest.fn().mockResolvedValue(1),
  pttl: jest.fn().mockResolvedValue(-2),
  pexpire: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => mockRedis);
  return { __esModule: true, default: MockRedis };
});

describe('RedisStore', () => {
  let store: RedisStore;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'REDIS_HOST') return 'localhost';
      if (key === 'REDIS_PORT') return 6379;
      if (key === 'REDIS_KEY_PREFIX') return 'rl:';
      return undefined;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.pttl.mockResolvedValue(-2);
    store = new RedisStore(mockConfigService);
  });

  describe('increment', () => {
    it('should create a new record with count 1', async () => {
      const record = await store.increment('key-1', 60000);

      expect(mockRedis.incr).toHaveBeenCalledWith('rl:key-1');
      expect(mockRedis.pexpire).toHaveBeenCalledWith('rl:key-1', 60000);
      expect(record.count).toBe(1);
      expect(record.resetAt).toBeGreaterThan(Date.now());
    });

    it('should increment count on subsequent calls', async () => {
      mockRedis.incr.mockResolvedValue(3);
      mockRedis.pttl.mockResolvedValue(45000);

      const record = await store.increment('key-1', 60000);

      expect(record.count).toBe(3);
    });

    it('should not set expiry when key already exists', async () => {
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.pttl.mockResolvedValue(30000);

      await store.increment('key-1', 60000);

      expect(mockRedis.pexpire).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await store.get('no-such-key');

      expect(result).toBeNull();
    });

    it('should return the record for an existing key', async () => {
      mockRedis.get.mockResolvedValue('3');
      mockRedis.pttl.mockResolvedValue(25000);

      const record = await store.get('key-1');

      expect(record).not.toBeNull();
      expect(record?.count).toBe(3);
    });

    it('should not increment the count', async () => {
      mockRedis.get.mockResolvedValue('1');
      mockRedis.pttl.mockResolvedValue(50000);

      await store.get('key-1');
      await store.get('key-1');
      const record = await store.get('key-1');

      expect(mockRedis.incr).not.toHaveBeenCalled();
      expect(record?.count).toBe(1);
    });
  });

  describe('reset', () => {
    it('should delete an existing key', async () => {
      await store.reset('key-1');

      expect(mockRedis.del).toHaveBeenCalledWith('rl:key-1');
    });
  });

  describe('cleanup', () => {
    it('should be a no-op', async () => {
      await expect(store.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit the Redis client', async () => {
      await store.onModuleDestroy();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
