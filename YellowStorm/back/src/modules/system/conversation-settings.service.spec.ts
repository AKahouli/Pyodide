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

  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockReset();
    findOneAndUpdate.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

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
    expect(result.redactSensitiveText).toBe(true);
  });

  it('preloads a persisted disabled setting before serving requests', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ value: { redactSensitiveText: false } }) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await service.onModuleInit();

    expect(service.shouldRedactSensitiveText()).toBe(false);
  });

  it('does not start with an unknown redaction policy', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockRejectedValue(new Error('database unavailable')) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await expect(service.onModuleInit()).rejects.toThrow('database unavailable');
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('validates and persists a configured active default agent', async () => {
    const value = { composerSuggestions: { ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions, agentId: '507f1f77bcf86cd799439011' } };
    agents.assertActiveDefaultAgent.mockResolvedValue(undefined);
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ updatedAt: new Date('2026-07-20T00:00:00Z') }) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await expect(service.updateSettings(value)).resolves.toMatchObject(value);
    expect(agents.assertActiveDefaultAgent).toHaveBeenCalledWith(value.composerSuggestions.agentId);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'conversation_settings' },
      { key: 'conversation_settings', value: { ...value, redactSensitiveText: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('persists an explicit sensitive text redaction change', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({}) }) });
    const service = new ConversationSettingsService(model as any, agents as any);

    await expect(service.updateSensitiveTextRedaction(false)).resolves.toMatchObject({ redactSensitiveText: false });
    expect(service.shouldRedactSensitiveText()).toBe(false);
  });

  it('keeps the last confirmed value while an expired setting refreshes', async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    findOne.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockReturnValue(new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        })),
      }),
    });
    const service = new ConversationSettingsService(model as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    rejectRefresh(new Error('database unavailable'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('bounds how long a disabled value remains usable during a stalled refresh', () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockReturnValue(new Promise(() => undefined)) }) });
    const service = new ConversationSettingsService(model as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: 10_000,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    jest.spyOn(Date, 'now').mockReturnValue(11_001);
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('does not let an older successful refresh overwrite an admin update', async () => {
    let resolveRefresh: (value: unknown) => void = () => undefined;
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; })) }) });
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({}) }) });
    const service = new ConversationSettingsService(model as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    await service.updateSensitiveTextRedaction(true);
    resolveRefresh({ value: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('does not let an older failed refresh clear an admin update', async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectRefresh = reject; })) }) });
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({}) }) });
    const service = new ConversationSettingsService(model as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    await service.updateSensitiveTextRedaction(true);
    rejectRefresh(new Error('stale refresh failed'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('fails closed when an expired setting cannot be refreshed', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockRejectedValue(new Error('database unavailable')) }) });
    const service = new ConversationSettingsService(model as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });
});
