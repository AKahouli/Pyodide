import { WhatsAppSessionManager } from './whatsapp-session.manager';

describe('WhatsAppSessionManager.sendToWorkyGroup', () => {
  const build = () => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    };
    const workyGroupService = { resolveGroupJid: jest.fn() };
    const manager = new WhatsAppSessionManager(
      {} as never,
      logger as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workyGroupService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { manager, workyGroupService };
  };

  it('returns not_configured when the stream has no bridge group', async () => {
    const { manager, workyGroupService } = build();
    workyGroupService.resolveGroupJid.mockResolvedValue(null);

    await expect(manager.sendToWorkyGroup('stream-1', 'hello')).resolves.toBe(
      'not_configured',
    );
  });

  it('throws when the system bot is temporarily offline', async () => {
    const { manager, workyGroupService } = build();
    workyGroupService.resolveGroupJid.mockResolvedValue('group@g.us');
    jest.spyOn(manager, 'getSystemBotSocket').mockReturnValue(undefined);

    await expect(manager.sendToWorkyGroup('stream-1', 'hello')).rejects.toThrow(
      'system bot socket is not active',
    );
  });

  it('returns sent after the provider accepts the message', async () => {
    const { manager, workyGroupService } = build();
    workyGroupService.resolveGroupJid.mockResolvedValue('group@g.us');
    const sendMessage = jest.fn().mockResolvedValue({ key: {} });
    jest.spyOn(manager, 'getSystemBotSocket').mockReturnValue({ sendMessage } as never);

    await expect(manager.sendToWorkyGroup('stream-1', 'hello')).resolves.toBe('sent');
    expect(sendMessage).toHaveBeenCalledWith('group@g.us', { text: 'hello' });
  });
});
