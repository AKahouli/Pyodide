import { Test } from '@nestjs/testing';
import { ModelsService } from './models.service';
import { LiteLLMClient } from './litellm.client';
import { LoggerService } from '../logger';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { LiteLLMModelInfoEntry } from './interfaces/model.interface';
import { MODEL_STORE, type ModelRow, type ModelStore } from './persistence/model.store';

// Helper to build a LiteLLM /v1/model/info entry
function entry(name: string, mode: string | undefined, provider = 'openai'): LiteLLMModelInfoEntry {
  return {
    model_name: name,
    litellm_params: { model: `${provider}/${name}` },
    model_info: {
      id: name,
      litellm_provider: provider,
      mode: mode as string,
      max_tokens: null,
      max_input_tokens: null,
      max_output_tokens: null,
      input_cost_per_token: null,
      output_cost_per_token: null,
      supports_vision: null,
      supports_function_calling: null,
      supports_reasoning: null,
    },
  };
}

function row(overrides: Partial<ModelRow>): ModelRow {
  return {
    id: overrides.modelId ?? 'id',
    modelId: 'model',
    name: 'Model',
    chef: 'OpenAI',
    chefSlug: 'openai',
    litellmModel: 'openai/model',
    providers: ['openai'],
    type: 'chat',
    types: ['chat'],
    isActive: true,
    isDefault: false,
    isConversationV2Default: false,
    omitTemperature: false,
    inputModalities: ['text'],
    maxInputTokens: null,
    maxOutputTokens: null,
    inputCostPerToken: null,
    outputCostPerToken: null,
    cachedInputCostPerToken: null,
    supportsReasoning: null,
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ModelRow;
}

class InMemoryModelStore implements ModelStore {
  readonly rows = new Map<string, ModelRow>();
  readonly inserted: ModelRow[] = [];
  readonly clearedClassifierFor: string[] = [];
  readonly exclusiveFlags: Array<{ modelId: string; flag: 'isDefault' | 'isConversationV2Default' }> = [];
  deactivatedNotIn: string[][] = [];

  async findByModelId(modelId: string): Promise<ModelRow | null> {
    return this.rows.get(modelId) ?? null;
  }

  async findByIdOrLitellmModel(id: string): Promise<ModelRow | null> {
    return this.rows.get(id) ?? null;
  }

  async list(options: ModelStore extends never ? never : { activeOnly?: boolean; chatOnly?: boolean; chefSlug?: string }): Promise<ModelRow[]> {
    let rows = [...this.rows.values()];
    if (options.activeOnly) rows = rows.filter((r) => r.isActive);
    if (options.chatOnly) rows = rows.filter((r) => r.types.includes('chat') || r.type === 'chat');
    if (options.chefSlug) rows = rows.filter((r) => r.chefSlug === options.chefSlug);
    return rows;
  }

  async insert(newRow: ModelRow): Promise<void> {
    this.inserted.push(newRow);
    this.rows.set(newRow.modelId, newRow);
  }

  async updateByModelId(modelId: string, patch: Partial<ModelRow>): Promise<ModelRow | null> {
    const current = this.rows.get(modelId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.rows.set(modelId, next);
    return next;
  }

  async deactivateNotIn(modelIds: string[]): Promise<number> {
    this.deactivatedNotIn.push(modelIds);
    let n = 0;
    for (const r of this.rows.values()) {
      if (!modelIds.includes(r.modelId) && r.isActive) {
        r.isActive = false;
        n++;
      }
    }
    return n;
  }

  async clearGuardrailsClassifierExcept(modelId: string): Promise<void> {
    this.clearedClassifierFor.push(modelId);
  }

  async setExclusiveFlag(modelId: string, flag: 'isDefault' | 'isConversationV2Default'): Promise<ModelRow | null> {
    this.exclusiveFlags.push({ modelId, flag });
    for (const r of this.rows.values()) (r as any)[flag] = false;
    const target = this.rows.get(modelId);
    if (target) (target as any)[flag] = true;
    return target ?? null;
  }

  async findDefault(): Promise<ModelRow | null> {
    return [...this.rows.values()].find((r) => r.isDefault && r.isActive && (r.types.includes('chat') || r.type === 'chat')) ?? null;
  }

  async findConversationV2Default(): Promise<ModelRow | null> {
    return [...this.rows.values()].find((r) => r.isConversationV2Default && r.isActive && (r.types.includes('chat') || r.type === 'chat')) ?? null;
  }

  async findGuardrailsClassifier(): Promise<ModelRow | null> {
    return [...this.rows.values()].find((r) => r.isActive && (r.types.includes('guardrails_classifier') || r.type === 'guardrails_classifier')) ?? null;
  }
}

describe('ModelsService', () => {
  let svc: ModelsService;
  let store: InMemoryModelStore;
  let fetchModels: jest.Mock;

  beforeEach(async () => {
    store = new InMemoryModelStore();
    fetchModels = jest.fn();

    // Fake transactional db: withTransaction passes straight through (outer
    // and nested SAVEPOINT calls), so the sync's transactional wrap is
    // exercised without a database.
    const fakeTx: { transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> } = {
      transaction: async (cb) => cb(fakeTx),
    };
    const fakeDb = {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: MODEL_STORE, useValue: store as unknown as ModelStore },
        { provide: LiteLLMClient, useValue: { fetchModels, isConfigured: () => true } },
        { provide: DRIZZLE_DB, useValue: fakeDb },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    svc = mod.get(ModelsService);
  });

  describe('syncModels', () => {
    it('ingests ALL model types, not just chat (no more chat-only filter)', async () => {
      fetchModels.mockResolvedValue([entry('gpt-4o', 'chat'), entry('text-embedding-3', 'embedding'), entry('dall-e-3', 'image_generation')]);

      const result = await svc.syncModels();

      expect(store.inserted).toHaveLength(3);
      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
    });

    it('initialises new models with types from LiteLLM mode', async () => {
      fetchModels.mockResolvedValue([entry('text-embedding-3', 'embedding')]);

      await svc.syncModels();

      expect(store.inserted[0]).toEqual(
        expect.objectContaining({
          modelId: 'text-embedding-3',
          type: 'embedding',
          types: ['embedding'],
          inputModalities: ['text'],
        }),
      );
    });

    it('does not overwrite administrator-selected input modalities on re-sync', async () => {
      fetchModels.mockResolvedValue([entry('vision-model', 'chat', 'openai')]);
      store.rows.set('vision-model', row({
        modelId: 'vision-model',
        chefSlug: 'azure',
        litellmModel: 'azure/old',
        inputModalities: ['text', 'image'],
        isActive: true,
      }));

      await svc.syncModels();

      expect(store.rows.get('vision-model')!.inputModalities).toEqual(['text', 'image']);
    });

    it('leaves type empty for a model that has no mode', async () => {
      fetchModels.mockResolvedValue([entry('mystery-model', undefined)]);

      await svc.syncModels();

      expect(store.inserted[0]).toEqual(expect.objectContaining({ type: '', types: [] }));
    });

    it('never overwrites an existing model type on re-sync (admin choice wins)', async () => {
      fetchModels.mockResolvedValue([entry('gpt-4o', 'chat', 'openai')]);
      // Existing model whose provider changed -> forces an update, type was set to 'embedding' by admin
      store.rows.set('gpt-4o', row({
        modelId: 'gpt-4o',
        chefSlug: 'azure',
        litellmModel: 'azure/old',
        type: 'embedding',
        types: ['embedding'],
        isActive: true,
      }));

      await svc.syncModels();

      expect(store.rows.get('gpt-4o')!.type).toBe('embedding');
    });
  });

  describe('findAll', () => {
    it('restricts to active chat models by default (public usage)', async () => {
      store.rows.set('inactive', row({ modelId: 'inactive', isActive: false }));
      store.rows.set('embedding', row({ modelId: 'embedding', type: 'embedding', types: ['embedding'] }));
      store.rows.set('chat', row({ modelId: 'chat' }));

      const result = await svc.findAll();

      expect(result.models.map((m) => m.id)).toEqual(['chat']);
    });

    it('returns every type when chatOnly=false (admin usage)', async () => {
      store.rows.set('inactive', row({ modelId: 'inactive', isActive: false }));
      store.rows.set('chat', row({ modelId: 'chat' }));

      const result = await svc.findAll(false, false);

      expect(result.total).toBe(2);
    });
  });

  describe('findByChef', () => {
    it('restricts to active chat models of the provider', async () => {
      store.rows.set('other-chef', row({ modelId: 'other-chef', chefSlug: 'anthropic', chef: 'Anthropic' }));
      store.rows.set('openai-chat', row({ modelId: 'openai-chat' }));

      const result = await svc.findByChef('OpenAI');

      expect(result.models.map((m) => m.id)).toEqual(['openai-chat']);
    });
  });

  describe('type compatibility', () => {
    it('returns a types array for legacy scalar classifications', async () => {
      store.rows.set('legacy-chat', row({
        modelId: 'legacy-chat',
        name: 'Legacy Chat',
        // legacy rows have no types array — only the scalar `type`
        types: null as unknown as string[],
      }));

      const result = await svc.findAll(false, false);

      expect(result.models[0]).toEqual(
        expect.objectContaining({
          type: 'chat',
          types: ['chat'],
          inputModalities: ['text'],
        }),
      );
    });

    it('returns valid persisted input modalities', async () => {
      store.rows.set('vision', row({
        modelId: 'vision',
        name: 'Vision',
        inputModalities: ['text', 'image', 'invalid' as never],
      }));

      const result = await svc.findAll(false, false);

      expect(result.models[0].inputModalities).toEqual(['text', 'image']);
    });

    it('keeps the legacy type synchronized with the first selected type', async () => {
      store.rows.set('multi', row({ modelId: 'multi', name: 'Multi' }));

      await svc.updateModel('multi', { types: ['chat', 'guardrails_classifier'] });

      // Guardrails classifier assigned to an active model — others must be cleared
      expect(store.clearedClassifierFor).toContain('multi');
      expect(store.rows.get('multi')!.type).toBe('chat');
    });

    it('clears a persisted default reasoning effort explicitly', async () => {
      store.rows.set('reasoning', row({ modelId: 'reasoning', name: 'Reasoning', defaultReasoningEffort: 'high' }));

      await svc.updateModel('reasoning', { defaultReasoningEffort: null });

      expect(store.rows.get('reasoning')!.defaultReasoningEffort).toBeNull();
    });

    it('rejects an active model that lacks the required chat type', async () => {
      store.rows.set('embedding', row({
        modelId: 'embedding',
        name: 'Embedding',
        type: 'embedding',
        types: ['embedding'],
      }));

      await expect(svc.validateModelActive('embedding', 'chat')).resolves.toEqual(expect.objectContaining({ valid: false, inactive: false, unsupported: true }));
    });

    it.each([
      [{ types: ['chat'] }, 'multi-type chat model'],
      [{ type: 'chat' }, 'legacy chat model'],
    ])('allows a %s as the default model', async (query, _description) => {
      store.rows.set('chat', row({ modelId: 'chat', name: 'Chat', ...query }));

      await svc.setDefaultModel('chat');

      expect(store.exclusiveFlags).toEqual([{ modelId: 'chat', flag: 'isDefault' }]);
    });

    it('does not clear the existing default for a non-chat or inactive model', async () => {
      store.rows.set('embedding', row({ modelId: 'embedding', type: 'embedding', types: ['embedding'] }));

      await expect(svc.setDefaultModel('embedding')).resolves.toBeNull();

      expect(store.exclusiveFlags).toHaveLength(0);
    });

    it('excludes legacy inactive or non-chat defaults', async () => {
      store.rows.set('inactive-default', row({ modelId: 'inactive-default', isDefault: true, isActive: false }));

      await expect(svc.getDefaultModel()).resolves.toBeNull();
    });
  });

  describe('conversation-v2 default', () => {
    it('queries the flagged active chat model only', async () => {
      store.rows.set('v2-default', row({ modelId: 'v2-default', isConversationV2Default: true, isActive: false }));

      await expect(svc.getConversationV2DefaultModel()).resolves.toBeNull();
    });

    it('allows an active chat model as the conversation-v2 default and clears the previous one', async () => {
      store.rows.set('chat', row({ modelId: 'chat', name: 'Chat' }));

      const result = await svc.setConversationV2DefaultModel('chat');

      expect(store.exclusiveFlags).toEqual([{ modelId: 'chat', flag: 'isConversationV2Default' }]);
      expect(result?.isConversationV2Default).toBe(true);
    });

    it('does not touch the conversation-v2 default for a non-chat or inactive model', async () => {
      store.rows.set('embedding', row({ modelId: 'embedding', type: 'embedding', types: ['embedding'] }));

      await expect(svc.setConversationV2DefaultModel('embedding')).resolves.toBeNull();

      expect(store.exclusiveFlags).toHaveLength(0);
    });

    it('clears the flag and surfaces it in the response', async () => {
      store.rows.set('chat', row({ modelId: 'chat', name: 'Chat', isConversationV2Default: true }));

      const result = await svc.clearConversationV2DefaultModel('chat');

      expect(result?.isConversationV2Default).toBe(false);
      expect(store.rows.get('chat')!.isConversationV2Default).toBe(false);
    });
  });
});
