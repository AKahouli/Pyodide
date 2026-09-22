import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys } from '../wire-helpers';
import { GuardrailsSettingsService } from '@modules/guardrails/services/guardrails-settings.service';

describe('guardrails settings contract', () => {
  it('getSettings on an empty singleton returns normalized defaults', async () => {
    const service = new GuardrailsSettingsService({ find: async () => null, upsert: async () => undefined } as never);
    const body = toWire(await service.getSettings());
    expectContract('guardrails/admin-settings', body);
    expect(body.forceActivation).toBe(false);
    expect(body.promptInjection.mode).toBe('balanced');
    expectNoMongoKeys(body);
  });

  it('a legacy stored row is normalized to the same shape', async () => {
    const legacy = { forceActivation: true, promptInjection: { inputGuardrailEnabled: true, classifierPrompt: 'legacy' } };
    const service = new GuardrailsSettingsService({ find: async () => legacy, upsert: async () => undefined } as never);
    const body = toWire(await service.getSettings());
    expectContract('guardrails/admin-settings', body);
    expect(body.promptInjection.inputEnabled).toBe(true);
    expect(body.promptInjection.inputClassifierPrompt).toBe('legacy');
  });
});
