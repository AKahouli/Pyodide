import { WorkyMessageController } from './worky-message.controller';

describe('WorkyMessageController', () => {
  let controller: WorkyMessageController;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let streamService: { getAiSessionId: jest.Mock };
  let grpcClient: { worky: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    planning = {
      appendOwnerMessage: jest.fn(),
      listMessages: jest.fn(),
    };
    streamService = {
      getAiSessionId: jest.fn(),
    };
    grpcClient = {
      worky: jest.fn().mockResolvedValue({ sessionId: 'sess-xyz', accepted: true }),
    };
    logger = {
      setContext: jest.fn(),
      error: jest.fn(),
    };

    controller = new WorkyMessageController(
      planning as any,
      streamService as any,
      grpcClient as any,
      logger as any,
    );
  });

  it('appends the owner message and kicks off the manager over gRPC', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.getAiSessionId.mockResolvedValue('sess-xyz');
    const user = { _id: { toString: () => 'user-1' } } as any;

    const res = await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('user-1', 'stream-1', { content: 'hi' });
    expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', expect.any(Object));
    expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
  });
});
