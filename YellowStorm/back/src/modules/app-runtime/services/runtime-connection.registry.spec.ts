import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { RuntimeConnectionRegistry } from './runtime-connection.registry';

const CONFIG = {
  'appRuntime.heartbeatTimeoutMs': 45_000,
  'appRuntime.mutationWaitMs': 30_000,
} as Record<string, number>;

const socketOf = (id: string) => ({ id, emit: jest.fn() }) as unknown as Socket;

const registerParams = (socket: Socket, overrides = {}) => ({
  socket,
  runtimeSessionId: 'rts_1',
  bindingId: 'arb_1',
  workspaceId: 'sess_1',
  userId: 'user_1',
  capabilities: { filesystem: true },
  revisionId: 'rev_0',
  ...overrides,
});

describe('RuntimeConnectionRegistry', () => {
  let registry: RuntimeConnectionRegistry;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string, fallback?: number) => CONFIG[key] ?? fallback),
    } as unknown as ConfigService;
    registry = new RuntimeConnectionRegistry(config);
  });

  it('normalizes advertised capabilities so unknown ones default to false', () => {
    registry.register(registerParams(socketOf('s1')));

    expect(registry.get('sess_1')?.capabilities).toEqual({
      filesystem: true,
      npm: false,
      previewInspection: false,
      nativeBinaries: false,
    });
  });

  it('replaces the connection for a workspace and reports the evicted socket', () => {
    const first = socketOf('s1');
    expect(registry.register(registerParams(first))).toBeNull();

    const evicted = registry.register(registerParams(socketOf('s2')));

    expect(evicted?.socket).toBe(first);
    expect(registry.get('sess_1')?.socket.id).toBe('s2');
  });

  it('updates the existing entry in place when the same socket re-registers', () => {
    const socket = socketOf('s1');
    registry.register(registerParams(socket));
    const original = registry.get('sess_1')!;
    const lock = original.mutationLock;

    expect(registry.register(registerParams(socket, { revisionId: 'rev_1' }))).toBeNull();

    const current = registry.get('sess_1')!;
    expect(current).toBe(original);
    expect(current.revisionId).toBe('rev_1');
    expect(current.mutationLock).toBe(lock);
  });

  it('ignores an unregister coming from a socket that was already replaced', () => {
    registry.register(registerParams(socketOf('s1')));
    registry.register(registerParams(socketOf('s2')));

    expect(registry.unregister('sess_1', 's1')).toBe(false);
    expect(registry.get('sess_1')?.socket.id).toBe('s2');

    expect(registry.unregister('sess_1', 's2')).toBe(true);
    expect(registry.get('sess_1')).toBeNull();
  });

  it('treats a connection as stale once the heartbeat window elapses', () => {
    registry.register(registerParams(socketOf('s1')));
    const connection = registry.get('sess_1')!;

    expect(registry.isStale(connection, Date.now() + 44_000)).toBe(false);
    expect(registry.isStale(connection, Date.now() + 46_000)).toBe(true);
  });

  it('clears staleness and updates the revision on heartbeat', () => {
    registry.register(registerParams(socketOf('s1')));
    const stalled = Date.now() - 60_000;
    registry.get('sess_1')!.lastHeartbeatAt = stalled;

    const touched = registry.touch('sess_1', 'rev_9');

    expect(touched?.revisionId).toBe('rev_9');
    expect(registry.isStale(touched!)).toBe(false);
  });

  describe('withMutationLock', () => {
    const onTimeout = () => 'timed-out';

    it('serializes mutations on the same workspace', async () => {
      registry.register(registerParams(socketOf('s1')));
      const order: string[] = [];

      const slow = registry.withMutationLock('sess_1', onTimeout, async () => {
        order.push('first:start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('first:end');
        return 'first';
      });
      const fast = registry.withMutationLock('sess_1', onTimeout, async () => {
        order.push('second:start');
        return 'second';
      });

      await expect(Promise.all([slow, fast])).resolves.toEqual(['first', 'second']);
      expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    });

    it('releases the lock when the mutation throws', async () => {
      registry.register(registerParams(socketOf('s1')));

      await expect(
        registry.withMutationLock('sess_1', onTimeout, () =>
          Promise.reject(new Error('boom')),
        ),
      ).rejects.toThrow('boom');

      await expect(
        registry.withMutationLock('sess_1', onTimeout, async () => 'next'),
      ).resolves.toBe('next');
    });

    it('falls back to the timeout branch when the lock is held too long', async () => {
      const config = {
        get: jest.fn((key: string, fallback?: number) =>
          key === 'appRuntime.mutationWaitMs' ? 10 : (CONFIG[key] ?? fallback),
        ),
      } as unknown as ConfigService;
      registry = new RuntimeConnectionRegistry(config);
      registry.register(registerParams(socketOf('s1')));

      const holder = registry.withMutationLock(
        'sess_1',
        onTimeout,
        () => new Promise<string>((resolve) => setTimeout(() => resolve('held'), 60)),
      );
      const blocked = registry.withMutationLock(
        'sess_1',
        onTimeout,
        async () => 'should-not-run',
      );

      await expect(blocked).resolves.toBe('timed-out');
      await expect(holder).resolves.toBe('held');
    });

    it('keeps the mutation queue across a same-socket re-register', async () => {
      const socket = socketOf('s1');
      registry.register(registerParams(socket));
      const order: string[] = [];

      const first = registry.withMutationLock('sess_1', onTimeout, async () => {
        order.push('first:start');
        registry.register(registerParams(socket, { revisionId: 'rev_1' }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('first:end');
        return 'first';
      });
      const second = registry.withMutationLock('sess_1', onTimeout, async () => {
        order.push('second:start');
        return 'second';
      });

      await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
      expect(order).toEqual(['first:start', 'first:end', 'second:start']);
      expect(registry.get('sess_1')?.revisionId).toBe('rev_1');
    });

    it('keeps later waiters queued when one of them times out', async () => {
      const config = {
        get: jest.fn((key: string, fallback?: number) =>
          key === 'appRuntime.mutationWaitMs' ? 20 : (CONFIG[key] ?? fallback),
        ),
      } as unknown as ConfigService;
      registry = new RuntimeConnectionRegistry(config);
      registry.register(registerParams(socketOf('s1')));

      let holderDone = false;
      let ranWhileHeld = false;

      const holder = registry.withMutationLock(
        'sess_1',
        onTimeout,
        () =>
          new Promise<string>((resolve) =>
            setTimeout(() => {
              holderDone = true;
              resolve('held');
            }, 80),
          ),
      );
      const abandoned = registry.withMutationLock(
        'sess_1',
        onTimeout,
        async () => 'should-not-run',
      );
      const behindAbandoned = registry.withMutationLock(
        'sess_1',
        onTimeout,
        async () => {
          ranWhileHeld = !holderDone;
          return 'ran';
        },
      );

      await expect(abandoned).resolves.toBe('timed-out');
      await expect(behindAbandoned).resolves.toBe('timed-out');
      await expect(holder).resolves.toBe('held');
      expect(ranWhileHeld).toBe(false);
    });

    it('runs without a lock when no runtime is connected', async () => {
      await expect(
        registry.withMutationLock('sess_absent', onTimeout, async () => 'ran'),
      ).resolves.toBe('ran');
    });
  });
});
