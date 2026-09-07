import { WorkyMessageController } from './worky-message.controller';

describe('WorkyMessageController', () => {
  const user = { _id: { toString: () => 'user-1' } } as any;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let kickoff: { prepare: jest.Mock; dispatch: jest.Mock };
  let controller: WorkyMessageController;

  beforeEach(() => {
    planning = {
      appendOwnerMessage: jest.fn(),
      listMessages: jest.fn(),
    };
    kickoff = {
      prepare: jest.fn().mockResolvedValue({
        streamId: 'stream-1',
        userId: 'user-1',
        content: 'hi',
        turnId: 'turn-1',
      }),
      dispatch: jest.fn(),
    };
    controller = new WorkyMessageController(planning as any, kickoff as any);
  });

  it('preflights, persists, and dispatches an owner message in order', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });

    const result = await controller.sendMessage(user, 'stream-1', {
      content: 'hi',
      turnId: 'turn-1',
    } as any);

    expect(kickoff.prepare).toHaveBeenCalledWith({
      streamId: 'stream-1',
      userId: 'user-1',
      content: 'hi',
      turnId: 'turn-1',
      requester: user,
    });
    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('user-1', 'stream-1', {
      content: 'hi',
      turnId: 'turn-1',
    });
    expect(kickoff.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      planning.appendOwnerMessage.mock.invocationCallOrder[0],
    );
    expect(planning.appendOwnerMessage.mock.invocationCallOrder[0]).toBeLessThan(
      kickoff.dispatch.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      id: 'm1',
      content: 'hi',
      createdAt: 'now',
      turnId: 'turn-1',
      turnStarted: true,
    });
  });

  it('does not persist or dispatch when strict preflight fails', async () => {
    kickoff.prepare.mockRejectedValue(new Error('missing worky agents'));

    await expect(
      controller.sendMessage(user, 'stream-1', { content: 'hi' } as any),
    ).rejects.toThrow('missing worky agents');

    expect(planning.appendOwnerMessage).not.toHaveBeenCalled();
    expect(kickoff.dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch when message persistence fails', async () => {
    planning.appendOwnerMessage.mockRejectedValue(new Error('mongo unavailable'));

    await expect(
      controller.sendMessage(user, 'stream-1', { content: 'hi' } as any),
    ).rejects.toThrow('mongo unavailable');

    expect(kickoff.dispatch).not.toHaveBeenCalled();
  });
});
