import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ModelsService } from './models.service';
import { LiteLLMClient } from './litellm.client';
import { AiModel } from './schemas/model.schema';
import { LoggerService } from '../logger';
import { LiteLLMModelInfoEntry } from './interfaces/model.interface';

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

describe('ModelsService', () => {
  let svc: ModelsService;
  let find: jest.Mock;
  let findOne: jest.Mock;
  let create: jest.Mock;
  let updateOne: jest.Mock;
  let updateMany: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let fetchModels: jest.Mock;

  // Make aiModelModel.find(query) return the chainable .sort().lean().exec()
  function mockFindResult(result: unknown[]): void {
    find.mockReturnValue({
      sort: () => ({ lean: () => ({ exec: () => Promise.resolve(result) }) }),
    });
  }

  beforeEach(async () => {
    find = jest.fn();
    findOne = jest.fn();
    create = jest.fn().mockResolvedValue({});
    updateOne = jest.fn().mockResolvedValue({});
    updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    findOneAndUpdate = jest.fn();
    fetchModels = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        ModelsService,
        {
          provide: getModelToken(AiModel.name),
          useValue: { find, findOne, findOneAndUpdate, create, updateOne, updateMany },
        },
        { provide: LiteLLMClient, useValue: { fetchModels, isConfigured: () => true } },
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
      findOne.mockResolvedValue(null); // all new

      const result = await svc.syncModels();

      expect(create).toHaveBeenCalledTimes(3);
      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
    });

    it('initialises new models with types from LiteLLM mode', async () => {
      fetchModels.mockResolvedValue([entry('text-embedding-3', 'embedding')]);
      findOne.mockResolvedValue(null);

      await svc.syncModels();

      expect(create).toHaveBeenCalledWith(
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
      findOne.mockResolvedValue({
        modelId: 'vision-model',
        chefSlug: 'azure',
        litellmModel: 'azure/old',
        inputModalities: ['text', 'image'],
        isActive: true,
      });

      await svc.syncModels();

      expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('inputModalities');
    });

    it('leaves type empty for a model that has no mode', async () => {
      fetchModels.mockResolvedValue([entry('mystery-model', undefined)]);
      findOne.mockResolvedValue(null);

      await svc.syncModels();

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: '', types: [] }));
    });

    it('never overwrites an existing model type on re-sync (admin choice wins)', async () => {
      fetchModels.mockResolvedValue([entry('gpt-4o', 'chat', 'openai')]);
      // Existing model whose provider changed -> forces an update, type was set to 'embedding' by admin
      findOne.mockResolvedValue({
        modelId: 'gpt-4o',
        chefSlug: 'azure',
        litellmModel: 'azure/old',
        type: 'embedding',
        isActive: true,
      });

      await svc.syncModels();

      expect(updateOne).toHaveBeenCalledTimes(1);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(setArg).not.toHaveProperty('type');
    });
  });

  describe('findAll', () => {
    it('restricts to active chat models by default (public usage)', async () => {
      mockFindResult([]);
      await svc.findAll();
      expect(find).toHaveBeenCalledWith({
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      });
    });

    it('returns every type when chatOnly=false (admin usage)', async () => {
      mockFindResult([]);
      await svc.findAll(false, false);
      expect(find).toHaveBeenCalledWith({});
    });
  });

  describe('findByChef', () => {
    it('restricts to active chat models of the provider', async () => {
      mockFindResult([]);
      await svc.findByChef('OpenAI');
      expect(find).toHaveBeenCalledWith({
        chefSlug: 'openai',
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      });
    });
  });

  describe('type compatibility', () => {
    it('returns a types array for legacy scalar classifications', async () => {
      mockFindResult([
        {
          modelId: 'legacy-chat',
          name: 'Legacy Chat',
          chef: 'OpenAI',
          chefSlug: 'openai',
          litellmModel: 'openai/legacy-chat',
          providers: ['openai'],
          type: 'chat',
          isActive: true,
          isDefault: false,
        },
      ]);

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
      mockFindResult([
        {
          modelId: 'vision',
          name: 'Vision',
          chef: 'OpenAI',
          chefSlug: 'openai',
          litellmModel: 'openai/vision',
          providers: ['openai'],
          type: 'chat',
          types: ['chat'],
          inputModalities: ['text', 'image', 'invalid'],
          isActive: true,
        },
      ]);

      const result = await svc.findAll(false, false);

      expect(result.models[0].inputModalities).toEqual(['text', 'image']);
    });

    it('keeps the legacy type synchronized with the first selected type', async () => {
      findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'multi',
              name: 'Multi',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/multi',
              providers: ['openai'],
              type: 'chat',
              types: ['chat', 'guardrails_classifier'],
              isActive: true,
              isDefault: false,
            }),
        }),
      });

      await svc.updateModel('multi', { types: ['chat', 'guardrails_classifier'] });

      expect(updateMany).toHaveBeenCalledWith({ modelId: { $ne: 'multi' }, isActive: true }, { $pull: { types: 'guardrails_classifier' } });
      expect(findOneAndUpdate).toHaveBeenCalledWith({ modelId: 'multi' }, { $set: { types: ['chat', 'guardrails_classifier'], type: 'chat' } }, { new: true });
    });

    it('clears a persisted default reasoning effort explicitly', async () => {
      findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'reasoning',
              name: 'Reasoning',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/reasoning',
              providers: ['openai'],
              type: 'chat',
              types: ['chat'],
              isActive: true,
              isDefault: false,
            }),
        }),
      });

      await svc.updateModel('reasoning', { defaultReasoningEffort: null });

      expect(findOneAndUpdate).toHaveBeenCalledWith({ modelId: 'reasoning' }, { $set: {}, $unset: { defaultReasoningEffort: 1 } }, { new: true });
    });

    it('finds guardrails classifiers classified through types', async () => {
      const sort = jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      findOne.mockReturnValue({ sort });

      await svc.getGuardrailsClassifierModel();

      expect(findOne).toHaveBeenCalledWith({
        isActive: true,
        $or: [{ types: 'guardrails_classifier' }, { type: 'guardrails_classifier' }],
      });
    });

    it('rejects an active model that lacks the required chat type', async () => {
      findOne.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'embedding',
              name: 'Embedding',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/embedding',
              providers: ['openai'],
              type: 'embedding',
              types: ['embedding'],
              isActive: true,
              isDefault: false,
            }),
        }),
      });

      await expect(svc.validateModelActive('embedding', 'chat')).resolves.toEqual(expect.objectContaining({ valid: false, inactive: false, unsupported: true }));
    });

    it.each([
      [{ types: ['chat'] }, 'multi-type chat model'],
      [{ type: 'chat' }, 'legacy chat model'],
    ])('allows a %s as the default model', async (query, _description) => {
      findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ modelId: 'chat' }) }),
      });
      findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'chat',
              name: 'Chat',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/chat',
              providers: ['openai'],
              type: 'chat',
              types: ['chat'],
              isActive: true,
              isDefault: true,
            }),
        }),
      });

      await svc.setDefaultModel('chat');

      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'chat',
          isActive: true,
          $or: [{ types: 'chat' }, { type: 'chat' }],
        }),
      );
      expect(updateMany).toHaveBeenCalledWith({ isDefault: true }, { $set: { isDefault: false } });
      expect(findOneAndUpdate).toHaveBeenCalled();
    });

    it('does not clear the existing default for a non-chat or inactive model', async () => {
      findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });

      await expect(svc.setDefaultModel('embedding')).resolves.toBeNull();

      expect(updateMany).not.toHaveBeenCalled();
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('excludes legacy inactive or non-chat defaults', async () => {
      const sort = jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      findOne.mockReturnValue({ sort, lean: () => ({ exec: () => Promise.resolve(null) }) });

      await svc.getDefaultModel();

      expect(findOne).toHaveBeenCalledWith({
        isDefault: true,
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      });
    });
  });

  describe('conversation-v2 default', () => {
    it('queries the flagged active chat model only', async () => {
      const sort = jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      findOne.mockReturnValue({ sort, lean: () => ({ exec: () => Promise.resolve(null) }) });

      await svc.getConversationV2DefaultModel();

      expect(findOne).toHaveBeenCalledWith({
        isConversationV2Default: true,
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      });
    });

    it('allows an active chat model as the conversation-v2 default and clears the previous one', async () => {
      findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ modelId: 'chat' }) }),
      });
      findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'chat',
              name: 'Chat',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/chat',
              providers: ['openai'],
              type: 'chat',
              types: ['chat'],
              isActive: true,
              isDefault: false,
              isConversationV2Default: true,
            }),
        }),
      });

      const result = await svc.setConversationV2DefaultModel('chat');

      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'chat',
          isActive: true,
          $or: [{ types: 'chat' }, { type: 'chat' }],
        }),
      );
      expect(updateMany).toHaveBeenCalledWith({ isConversationV2Default: true }, { $set: { isConversationV2Default: false } });
      expect(findOneAndUpdate).toHaveBeenCalledWith({ modelId: 'chat' }, { $set: { isConversationV2Default: true } }, { new: true });
      expect(result?.isConversationV2Default).toBe(true);
    });

    it('does not touch the conversation-v2 default for a non-chat or inactive model', async () => {
      findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });

      await expect(svc.setConversationV2DefaultModel('embedding')).resolves.toBeNull();

      expect(updateMany).not.toHaveBeenCalled();
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('clears the flag and surfaces it in the response', async () => {
      findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              modelId: 'chat',
              name: 'Chat',
              chef: 'OpenAI',
              chefSlug: 'openai',
              litellmModel: 'openai/chat',
              providers: ['openai'],
              type: 'chat',
              types: ['chat'],
              isActive: true,
              isDefault: false,
              isConversationV2Default: false,
            }),
        }),
      });

      const result = await svc.clearConversationV2DefaultModel('chat');

      expect(findOneAndUpdate).toHaveBeenCalledWith({ modelId: 'chat' }, { $set: { isConversationV2Default: false } }, { new: true });
      expect(result?.isConversationV2Default).toBe(false);
    });
  });
});
