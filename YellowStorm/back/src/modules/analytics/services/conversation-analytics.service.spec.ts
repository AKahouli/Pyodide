import { ConversationAnalyticsService } from './conversation-analytics.service';

describe('ConversationAnalyticsService', () => {
  it('delegates neutral user IDs to the selected store', async () => {
    const expected = { totalConversations: 0 };
    const store = { getConversationAnalytics: jest.fn().mockResolvedValue(expected) };
    const service = new ConversationAnalyticsService(store as never);

    await expect(service.getConversationAnalytics(['user-1'])).resolves.toBe(expected);
    expect(store.getConversationAnalytics).toHaveBeenCalledWith(
      ['user-1'],
      undefined,
      undefined,
      undefined,
    );
  });
});
