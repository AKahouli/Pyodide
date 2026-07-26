import { NEVER, firstValueFrom } from 'rxjs';
import { StreamController } from './stream.controller';

describe('StreamController', () => {
  it('emits connected after subscription and cleans up on close', async () => {
    const closeHandlers: Array<() => void> = [];
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

    expect(firstEvent).toEqual({
      type: 'connected',
      data: { connectionId: expect.stringContaining('user-1:session-1:') },
    });
    closeHandlers[0]();
    expect(gateway.removeConnection).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('user-1:session-1:'),
    );
    expect(request.socket.setNoDelay).toHaveBeenCalledWith(true);
  });
});
