import { NEVER, firstValueFrom } from 'rxjs';
import { StreamController } from './stream.controller';

describe('StreamController', () => {
  it('emits connected after subscription and cleans up on close', async () => {
    const closeHandlers: (() => void)[] = [];
    const request = {
      sseUser: { sub: 'user-1', sessionId: 'session-1' },
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandlers.push(handler);
      }),
      socket: { setNoDelay: jest.fn() },
    };
    const gateway = {
      registerConnection: jest.fn().mockReturnValue(NEVER),
      removeConnection: jest.fn(),
    };
    const controller = new StreamController(gateway as never);

    const firstEvent = await firstValueFrom(controller.stream(request as never));

    const data = firstEvent.data as { connectionId: string };
    expect(firstEvent.type).toBe('connected');
    expect(data.connectionId).toMatch(/^user-1:session-1:/);
    closeHandlers[0]();
    expect(gateway.removeConnection).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('user-1:session-1:'),
    );
    expect(request.socket.setNoDelay).toHaveBeenCalledWith(true);
  });

  it('passes a well-formed reconnect cursor through to the gateway', () => {
    const gateway = {
      registerConnection: jest.fn().mockReturnValue(NEVER),
      removeConnection: jest.fn(),
    };
    const controller = new StreamController(gateway as never);
    const request = {
      sseUser: { sub: 'user-1', sessionId: 'session-1' },
      on: jest.fn(),
      socket: { setNoDelay: jest.fn() },
    };

    controller.stream(request as never, '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0:42');

    expect(gateway.registerConnection).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('user-1:session-1:'),
      expect.anything(),
      '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0:42',
    );
  });

  it('treats malformed cursors as a first connection', () => {
    const gateway = {
      registerConnection: jest.fn().mockReturnValue(NEVER),
      removeConnection: jest.fn(),
    };
    const controller = new StreamController(gateway as never);
    const request = {
      sseUser: { sub: 'user-1', sessionId: 'session-1' },
      on: jest.fn(),
      socket: { setNoDelay: jest.fn() },
    };

    controller.stream(request as never, 'no-separator');
    controller.stream(request as never, 'boot:99999999999999999999');
    controller.stream(request as never, '../etc/passwd:1');

    const calls = gateway.registerConnection.mock.calls as unknown[][];
    for (const call of calls) {
      expect(call[3]).toBeUndefined();
    }
  });
});
