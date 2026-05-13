import { MemoryStore } from './memory.store';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new MemoryStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('increment', () => {
    it('should create a new record on first call', async () => {
      const record = await store.increment('key-1', 60000);

      expect(record.count).toBe(1);
      expect(record.firstRequestAt).toBeLessThanOrEqual(Date.now());
      expect(record.resetAt).toBeGreaterThan(Date.now());
    });

    it('should increment count on subsequent calls within the window', async () => {
      await store.increment('key-1', 60000);
      await store.increment('key-1', 60000);
      const record = await store.increment('key-1', 60000);

      expect(record.count).toBe(3);
    });

    it('should reset count when window expires', async () => {
      await store.increment('key-1', 5000);
      await store.increment('key-1', 5000);

      // Advance past the window
      jest.advanceTimersByTime(6000);

      const record = await store.increment('key-1', 5000);

      expect(record.count).toBe(1);
    });

    it('should set resetAt to now + windowMs for new records', async () => {
      const now = Date.now();
      const record = await store.increment('key-1', 30000);

      expect(record.resetAt).toBe(now + 30000);
    });

    it('should keep the same resetAt within the window', async () => {
      const first = await store.increment('key-1', 60000);
      jest.advanceTimersByTime(1000);
      const second = await store.increment('key-1', 60000);

      expect(second.resetAt).toBe(first.resetAt);
    });

    it('should track different keys independently', async () => {
      await store.increment('key-a', 60000);
      await store.increment('key-a', 60000);
      await store.increment('key-b', 60000);

      const a = await store.get('key-a');
      const b = await store.get('key-b');

      expect(a?.count).toBe(2);
      expect(b?.count).toBe(1);
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await store.get('no-such-key');

      expect(result).toBeNull();
    });

    it('should return the record for an existing key', async () => {
      await store.increment('key-1', 60000);
      const record = await store.get('key-1');

      expect(record).not.toBeNull();
      expect(record?.count).toBe(1);
    });

    it('should return null and delete expired records', async () => {
      await store.increment('key-1', 5000);

      jest.advanceTimersByTime(6000);

      const record = await store.get('key-1');

      expect(record).toBeNull();
    });

    it('should not increment the count', async () => {
      await store.increment('key-1', 60000);
      await store.get('key-1');
      await store.get('key-1');
      const record = await store.get('key-1');

      expect(record?.count).toBe(1);
    });
  });

  describe('reset', () => {
    it('should delete an existing record', async () => {
      await store.increment('key-1', 60000);
      await store.reset('key-1');

      const record = await store.get('key-1');

      expect(record).toBeNull();
    });

    it('should not throw for non-existent keys', async () => {
      await expect(store.reset('no-such-key')).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove expired records', async () => {
      await store.increment('expired', 1000);
      await store.increment('valid', 120000);

      jest.advanceTimersByTime(2000);

      await store.cleanup();

      expect(await store.get('expired')).toBeNull();
      expect(await store.get('valid')).not.toBeNull();
    });

    it('should keep non-expired records untouched', async () => {
      await store.increment('key-1', 60000);
      await store.increment('key-1', 60000);

      await store.cleanup();

      const record = await store.get('key-1');

      expect(record?.count).toBe(2);
    });

    it('should run automatically via interval', async () => {
      await store.increment('short-lived', 30000);

      // Advance past the window + cleanup interval (60s)
      jest.advanceTimersByTime(65000);

      // The automatic cleanup should have removed it
      expect(await store.get('short-lived')).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear all records', async () => {
      await store.increment('key-1', 60000);
      await store.increment('key-2', 60000);

      store.onModuleDestroy();

      expect(await store.get('key-1')).toBeNull();
      expect(await store.get('key-2')).toBeNull();
    });
  });
});
