import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { ModelsService } from '@modules/models/models.service';
import type { ModelRow } from '@modules/models/persistence/model.store';

const row: ModelRow = {
  id: '64b000000000000000000401',
  modelId: 'gpt-4o',
  name: 'GPT-4o',
  chef: 'OpenAI',
  chefSlug: 'openai',
  litellmModel: 'openai/gpt-4o',
  providers: ['openai', 'azure'],
  type: 'chat',
  types: ['chat'],
  isActive: true,
  isDefault: true,
  isConversationV2Default: false,
  omitTemperature: false,
  inputModalities: ['text', 'image'],
  maxInputTokens: 128000,
  maxOutputTokens: 16384,
  inputCostPerToken: 0.0000025,
  outputCostPerToken: 0.00001,
  cachedInputCostPerToken: null,
  supportsReasoning: true,
  reasoningEfforts: [{ id: 'low', name: 'Low', description: 'Fast' }],
  defaultReasoningEffort: 'low',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('models response contract', () => {
  it('toModelResponse exposes the public id (modelId) and no internal columns', () => {
    const body = toWire(callPrivate(ModelsService, 'toModelResponse', [row]));
    expectContract('models/model', body);
    expect(body.id).toBe('gpt-4o');
    expect(body.reasoning).toEqual({ efforts: [{ id: 'low', name: 'Low', description: 'Fast' }], defaultEffort: 'low' });
    expectNoMongoKeys(body);
    expectNoKeys(body, 'modelId', 'inputCostPerToken', 'outputCostPerToken', 'cachedInputCostPerToken', 'createdAt');
  });

  it('defaults are stable for a minimal legacy row', () => {
    const body = toWire(
      callPrivate(ModelsService, 'toModelResponse', [
        { ...row, types: [], type: 'embedding', inputModalities: [], maxInputTokens: null, supportsReasoning: null, reasoningEfforts: [], defaultReasoningEffort: null },
      ]),
    );
    expect(body.type).toBe('embedding');
    expect(body.inputModalities).toEqual(['text']);
    expect(body.reasoning).toEqual({ efforts: [] });
  });
});
