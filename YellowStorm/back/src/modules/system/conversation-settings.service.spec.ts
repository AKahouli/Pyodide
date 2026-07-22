import { ConversationSettingsService } from './conversation-settings.service';
import { DEFAULT_CONVERSATION_SETTINGS } from './interfaces/conversation-settings.interface';

describe('ConversationSettingsService', () => {
  const findOne = jest.fn();
  const findOneAndUpdate = jest.fn();
  const agents = {
    assertActiveDefaultAgent: jest.fn(),
    listActiveDefaultAgentOptions: jest.fn(),
  };
  const model = { findOne, findOneAndUpdate };

  beforeEach(() => jest.clearAllMocks());

  it('returns safe defaults when no setting is persisted', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await expect(service.getSettings()).resolves.toEqual(DEFAULT_CONVERSATION_SETTINGS);
  });

  it('merges partial persisted values with defaults', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ value: { composerSuggestions: { enabled: false } } }) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    const result = await service.getSettings();
    expect(result.composerSuggestions).toEqual({ ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions, enabled: false });
  });

  it('validates and persists a configured active default agent', async () => {
    const value = { composerSuggestions: { ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions, agentId: '507f1f77bcf86cd799439011' } };
    agents.assertActiveDefaultAgent.mockResolvedValue(undefined);
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ updatedAt: new Date('2026-07-20T00:00:00Z') }) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await expect(service.updateSettings(value)).resolves.toMatchObject(value);
    expect(agents.assertActiveDefaultAgent).toHaveBeenCalledWith(value.composerSuggestions.agentId);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'conversation_settings' },
      { key: 'conversation_settings', value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });
});
