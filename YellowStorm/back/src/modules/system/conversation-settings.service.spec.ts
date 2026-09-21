import { ConversationSettingsService } from './conversation-settings.service';
import { DEFAULT_CONVERSATION_SETTINGS } from './interfaces/conversation-settings.interface';
import type { SystemSettingRow } from './persistence/system-setting.store';

const settingRow = (value: unknown): SystemSettingRow => ({
  key: 'conversation_settings',
  value,
  updatedAt: new Date('2026-07-20T00:00:00Z'),
});

describe('ConversationSettingsService', () => {
  const get = jest.fn<Promise<SystemSettingRow | null>, []>();
  const upsert = jest.fn<Promise<SystemSettingRow>, [string, unknown]>();
  const store = { get, upsert };
  const agents = {
    assertActiveDefaultAgent: jest.fn(),
    listActiveDefaultAgentOptions: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue(settingRow({}));
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns safe defaults when no setting is persisted', async () => {
    get.mockResolvedValue(null);
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(service.getSettings()).resolves.toEqual(DEFAULT_CONVERSATION_SETTINGS);
  });

  it('merges partial persisted values with defaults', async () => {
    get.mockResolvedValue(settingRow({ composerSuggestions: { enabled: false } }));
    const service = new ConversationSettingsService(store as any, agents as any);

    const result = await service.getSettings();
    expect(result.composerSuggestions).toEqual({ ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions, enabled: false });
    expect(result.redactSensitiveText).toBe(true);
  });

  it('preloads a persisted disabled setting before serving requests', async () => {
    get.mockResolvedValue(settingRow({ redactSensitiveText: false }));
    const service = new ConversationSettingsService(store as any, agents as any);

    await service.onModuleInit();

    expect(service.shouldRedactSensitiveText()).toBe(false);
  });

  it('does not start with an unknown redaction policy', async () => {
    get.mockRejectedValue(new Error('database unavailable'));
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(service.onModuleInit()).rejects.toThrow('database unavailable');
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('validates and persists a configured active default agent', async () => {
    const value = { composerSuggestions: { ...DEFAULT_CONVERSATION_SETTINGS.composerSuggestions, agentId: '507f1f77bcf86cd799439011' } };
    agents.assertActiveDefaultAgent.mockResolvedValue(undefined);
    get.mockResolvedValue(null);
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(service.updateSettings(value)).resolves.toMatchObject(value);
    expect(agents.assertActiveDefaultAgent).toHaveBeenCalledWith(value.composerSuggestions.agentId);
    expect(upsert).toHaveBeenCalledWith(
      'conversation_settings',
      { ...value, redactSensitiveText: true, latencyInstrumentationEnabled: true, conversationName: DEFAULT_CONVERSATION_SETTINGS.conversationName, compaction: DEFAULT_CONVERSATION_SETTINGS.compaction, attachmentIntelligence: DEFAULT_CONVERSATION_SETTINGS.attachmentIntelligence },
    );
  });

  it('persists an explicit latency instrumentation change and keeps it when omitted', async () => {
    get.mockResolvedValue(null);
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(
      service.updateSettings({
        composerSuggestions: DEFAULT_CONVERSATION_SETTINGS.composerSuggestions,
        latencyInstrumentationEnabled: false,
      }),
    ).resolves.toMatchObject({ latencyInstrumentationEnabled: false });
    expect(service.isLatencyInstrumentationEnabled()).resolves.toBe(false);

    // Omitted → keeps the persisted value instead of flipping back to default.
    await expect(
      service.updateSettings({ composerSuggestions: DEFAULT_CONVERSATION_SETTINGS.composerSuggestions }),
    ).resolves.toMatchObject({ latencyInstrumentationEnabled: false });
  });

  it('defaults latency instrumentation to enabled when not persisted', async () => {
    get.mockResolvedValue(settingRow({ redactSensitiveText: false }));
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(service.isLatencyInstrumentationEnabled()).resolves.toBe(true);
  });

  it('persists an explicit sensitive text redaction change', async () => {
    get.mockResolvedValue(null);
    const service = new ConversationSettingsService(store as any, agents as any);

    await expect(service.updateSensitiveTextRedaction(false)).resolves.toMatchObject({ redactSensitiveText: false });
    expect(service.shouldRedactSensitiveText()).toBe(false);
  });

  it('keeps the last confirmed value while an expired setting refreshes', async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    get.mockReturnValue(new Promise((_resolve, reject) => {
      rejectRefresh = reject;
    }));
    const service = new ConversationSettingsService(store as any, agents as any);
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
    get.mockReturnValue(new Promise(() => undefined) as unknown as Promise<SystemSettingRow | null>);
    const service = new ConversationSettingsService(store as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: 10_000,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    jest.spyOn(Date, 'now').mockReturnValue(11_001);
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('serves the cached latency switch synchronously after preload', async () => {
    get.mockResolvedValue(settingRow({ latencyInstrumentationEnabled: false }));
    const service = new ConversationSettingsService(store as any, agents as any);

    // Before any cache exists the accessor falls back to the default (enabled)
    // and must never block on settings I/O.
    expect(service.isLatencyInstrumentationEnabledCached()).toBe(true);

    await service.onModuleInit();

    expect(service.isLatencyInstrumentationEnabledCached()).toBe(false);
  });

  it('falls back to the default latency switch once the cache is too stale', async () => {
    get.mockRejectedValue(new Error('database unavailable'));
    const service = new ConversationSettingsService(store as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, latencyInstrumentationEnabled: false },
      expiresAt: Date.now() - 10_000,
    };

    expect(service.isLatencyInstrumentationEnabledCached()).toBe(true);
  });

  it('does not let an older successful refresh overwrite an admin update', async () => {
    let resolveRefresh: (value: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }) as unknown as Promise<SystemSettingRow | null>);
    const service = new ConversationSettingsService(store as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    await service.updateSensitiveTextRedaction(true);
    resolveRefresh(settingRow({ ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.shouldRedactSensitiveText()).toBe(true);
  });

  it('does not let an older failed refresh clear an admin update', async () => {
    let rejectRefresh: (error: Error) => void = () => undefined;
    get.mockReturnValue(new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    const service = new ConversationSettingsService(store as any, agents as any);
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
    get.mockRejectedValue(new Error('database unavailable'));
    const service = new ConversationSettingsService(store as any, agents as any);
    (service as any).cache = {
      settings: { ...DEFAULT_CONVERSATION_SETTINGS, redactSensitiveText: false },
      expiresAt: Date.now() - 1,
    };

    expect(service.shouldRedactSensitiveText()).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.shouldRedactSensitiveText()).toBe(true);
  });
});
