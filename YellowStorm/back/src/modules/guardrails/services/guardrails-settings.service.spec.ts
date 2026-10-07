import {
  DEFAULT_TOOL_ACTION_REVIEW,
  GuardrailsSettingsService,
  normalizeAdminGuardrailsSettings,
} from './guardrails-settings.service';
import type { GuardrailsSettingsStore } from '../persistence/guardrails-settings.store';
import { PgGuardrailsSettingsStore } from '../persistence/pg-guardrails-settings.store';

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
    const upsert = jest.fn().mockResolvedValue(undefined);
    const store = { find: jest.fn().mockResolvedValue(persisted), upsert } as unknown as PgGuardrailsSettingsStore;
    const service = new GuardrailsSettingsService(store);

    await service.updateSettings({ promptInjection: { outputEnabled: false } });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ forceActivation: true, promptInjection: expect.objectContaining({ inputEnabled: true, outputEnabled: false, mode: 'strict' }), toolActionReview: expect.objectContaining({ enabled: true }) }),
    );
  });
});
