import { MessageService } from './message.service';

describe('Message navigation boundary', () => {
  function service(redact = false) {
    const store = { searchConversationMessages: jest.fn().mockResolvedValue({ records: [], hasMore: false }), listAround: jest.fn().mockResolvedValue(null) };
    const instance = Object.create(MessageService.prototype) as MessageService;
    Object.assign(instance, { messageStore: store, resolveRedactSensitiveText: jest.fn().mockResolvedValue(redact) });
    return { instance, store };
  }
  it('does not query sensitive text when redaction is enabled', async () => {
    const { instance, store } = service(true);
    expect(await instance.searchConversationMessages('conversation', 'secret')).toEqual({ matches: [], hasMore: false });
    expect(store.searchConversationMessages).not.toHaveBeenCalled();
  });
  it.each(['', ' ', 'x'.repeat(201)])('rejects invalid search length', async query => {
    const { instance, store } = service();
    await expect(instance.searchConversationMessages('conversation', query)).rejects.toThrow();
    expect(store.searchConversationMessages).not.toHaveBeenCalled();
  });
  it.each([0, 21, 1.5])('rejects unbounded search limit %s', async limit => {
    await expect(service().instance.searchConversationMessages('conversation', 'valid', limit)).rejects.toThrow();
  });
  it('binds around targets to their conversation and rejects missing or foreign targets', async () => {
    const { instance, store } = service();
    await expect(instance.messagesAround('conversation', '0123456789abcdef01234567', 50)).rejects.toThrow();
    expect(store.listAround).toHaveBeenCalledWith('conversation', '0123456789abcdef01234567', 50);
    await expect(instance.messagesAround('conversation', '../foreign', 50)).rejects.toThrow();
    await expect(instance.messagesAround('conversation', '0123456789abcdef01234567', 101)).rejects.toThrow();
    expect(store.listAround).toHaveBeenCalledTimes(1);
  });
});
