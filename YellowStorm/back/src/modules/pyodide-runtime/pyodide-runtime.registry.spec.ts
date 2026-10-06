import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';

function fakeSocket(id: string, connected = true): Socket {
  return { id, connected, emit: jest.fn(), disconnect: jest.fn() } as unknown as Socket;
}

function fakeConfig(): ConfigService {
  return { get: jest.fn((_key: string, fallback: unknown) => fallback) } as unknown as ConfigService;
}

describe('PyodideRuntimeRegistry', () => {
  it('keeps a single runtime per user and evicts the previous connection', () => {
    const registry = new PyodideRuntimeRegistry(fakeConfig());
    const first = fakeSocket('socket-1');
    const second = fakeSocket('socket-2');

    expect(registry.register({ userId: 'user-1', socket: first, runtimeId: 'rt-1' })).toBeNull();
    const evicted = registry.register({ userId: 'user-1', socket: second, runtimeId: 'rt-2' });

    expect(evicted?.socket.id).toBe('socket-1');
    expect(registry.get('user-1')?.runtimeId).toBe('rt-2');
  });

  it('only unregisters the socket that still owns the user', () => {
    const registry = new PyodideRuntimeRegistry(fakeConfig());
    registry.register({ userId: 'user-1', socket: fakeSocket('socket-1'), runtimeId: 'rt-1' });

    expect(registry.unregister('user-1', 'other-socket')).toBe(false);
    expect(registry.unregister('user-1', 'socket-1')).toBe(true);
    expect(registry.get('user-1')).toBeNull();
  });

  it('tracks busy and ready transitions with the active execution id', () => {
    const registry = new PyodideRuntimeRegistry(fakeConfig());
    registry.register({ userId: 'user-1', socket: fakeSocket('socket-1'), runtimeId: 'rt-1' });

    registry.markBusy('user-1', 'pye_1');
    expect(registry.get('user-1')?.status).toBe('busy');
    expect(registry.get('user-1')?.activeExecutionId).toBe('pye_1');

    registry.markReady('user-1');
    expect(registry.get('user-1')?.status).toBe('ready');
    expect(registry.get('user-1')?.activeExecutionId).toBeUndefined();
  });

  it('considers a heartbeat beyond the configured timeout as stale', () => {
    const registry = new PyodideRuntimeRegistry(fakeConfig());
    registry.register({ userId: 'user-1', socket: fakeSocket('socket-1'), runtimeId: 'rt-1' });
    const connection = registry.get('user-1')!;

    expect(registry.isStale(connection, connection.lastHeartbeatAt + 30_001)).toBe(true);
    registry.touch('user-1');
    expect(registry.isStale(registry.get('user-1')!)).toBe(false);
  });
});
