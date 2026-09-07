import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateConversationSettingsDto, UpdateSensitiveTextRedactionDto } from './update-conversation-settings.dto';

describe('UpdateConversationSettingsDto', () => {
  it('rejects a missing composerSuggestions object', async () => {
    const errors = await validate(plainToInstance(UpdateConversationSettingsDto, {}));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'composerSuggestions' }),
    ]));
  });

  it('accepts complete bounded settings', async () => {
    const dto = plainToInstance(UpdateConversationSettingsDto, {
      composerSuggestions: {
        enabled: true,
        agentId: null,
        debounceMs: 400,
        minimumDraftLength: 3,
        requestsPerMinute: 60,
        maxOutputTokens: 256,
      },
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts a conversationName model name string (not a Mongo id)', async () => {
    const base = {
      composerSuggestions: { enabled: true, agentId: null, debounceMs: 400, minimumDraftLength: 3, requestsPerMinute: 60, maxOutputTokens: 256 },
    };
    await expect(validate(plainToInstance(UpdateConversationSettingsDto, { ...base, conversationName: { modelId: 'gpt-5.4-mini' } }))).resolves.toEqual([]);
    await expect(validate(plainToInstance(UpdateConversationSettingsDto, { ...base, conversationName: { modelId: null } }))).resolves.toEqual([]);
    await expect(validate(plainToInstance(UpdateConversationSettingsDto, { ...base, conversationName: { modelId: 123 } }))).resolves.not.toEqual([]);
  });

  it('validates the sensitive text redaction toggle as a boolean', async () => {
    await expect(validate(plainToInstance(UpdateSensitiveTextRedactionDto, { redactSensitiveText: false }))).resolves.toEqual([]);
    await expect(validate(plainToInstance(UpdateSensitiveTextRedactionDto, { redactSensitiveText: 'false' }))).resolves.not.toEqual([]);
  });

  it('validates the latency instrumentation toggle as a boolean', async () => {
    const base = {
      composerSuggestions: {
        enabled: true,
        agentId: null,
        debounceMs: 400,
        minimumDraftLength: 3,
        requestsPerMinute: 60,
        maxOutputTokens: 256,
      },
    };
    await expect(validate(plainToInstance(UpdateConversationSettingsDto, { ...base, latencyInstrumentationEnabled: false }))).resolves.toEqual([]);
    await expect(validate(plainToInstance(UpdateConversationSettingsDto, { ...base, latencyInstrumentationEnabled: 'false' }))).resolves.not.toEqual([]);
  });
});
