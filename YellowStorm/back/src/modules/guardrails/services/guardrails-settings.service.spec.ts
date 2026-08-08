import {
  DEFAULT_TOOL_ACTION_REVIEW,
  GuardrailsSettingsService,
  normalizeAdminGuardrailsSettings,
} from './guardrails-settings.service';

describe('GuardrailsSettingsService', () => {
  it('normalizes legacy prompt injection and tool-call fields into separate policies', () => {
    const normalized = normalizeAdminGuardrailsSettings({
      forceActivation: true,
      promptInjection: {
        inputGuardrailEnabled: true,
        outputGuardrailEnabled: false,
        toolCallGuardrailEnabled: true,
        toolCallClassifierPrompt: 'legacy tool policy',
      },
    });

    expect(normalized.promptInjection).toMatchObject({ inputEnabled: true, outputEnabled: false, mode: 'balanced' });
    expect(normalized.toolActionReview).toMatchObject({ enabled: true, classifierPrompt: 'legacy tool policy', mode: 'balanced' });
  });

  it('merges partial updates with persisted settings', async () => {
    const persisted = {
      forceActivation: true,
      promptInjection: { inputEnabled: true, outputEnabled: true, mode: 'strict', inputClassifierPrompt: 'in', outputClassifierPrompt: 'out', blockMessage: 'blocked' },
      toolActionReview: { ...DEFAULT_TOOL_ACTION_REVIEW, enabled: true },
    };
    const exec = jest.fn().mockResolvedValue(persisted);
    const model = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(persisted) }) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => ({ exec }) }),
    };
    const service = new GuardrailsSettingsService(model as never);

    await service.updateSettings({ promptInjection: { outputEnabled: false } });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: expect.objectContaining({ forceActivation: true, promptInjection: expect.objectContaining({ inputEnabled: true, outputEnabled: false, mode: 'strict' }), toolActionReview: expect.objectContaining({ enabled: true }) }) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });
});
