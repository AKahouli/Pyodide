import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ModelsService } from './models.service';
import { LiteLLMClient } from './litellm.client';
import { AiModel } from './schemas/model.schema';
import { LoggerService } from '../logger';
import { LiteLLMModelInfoEntry } from './interfaces/model.interface';

// Helper to build a LiteLLM /v1/model/info entry
function entry(
  name: string,
  mode: string | undefined,
  provider = 'openai',
): LiteLLMModelInfoEntry {
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
    fetchModels = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        ModelsService,
        {
          provide: getModelToken(AiModel.name),
          useValue: { find, findOne, create, updateOne, updateMany },
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
      fetchModels.mockResolvedValue([
        entry('gpt-4o', 'chat'),
        entry('text-embedding-3', 'embedding'),
        entry('dall-e-3', 'image_generation'),
      ]);
      findOne.mockResolvedValue(null); // all new

      const result = await svc.syncModels();

      expect(create).toHaveBeenCalledTimes(3);
      expect(result.added).toBe(3);
      expect(result.total).toBe(3);
    });

    it('initialises new models with type from LiteLLM mode', async () => {
      fetchModels.mockResolvedValue([entry('text-embedding-3', 'embedding')]);
      findOne.mockResolvedValue(null);

      await svc.syncModels();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'text-embedding-3', type: 'embedding' }),
      );
    });

    it('leaves type empty for a model that has no mode', async () => {
      fetchModels.mockResolvedValue([entry('mystery-model', undefined)]);
      findOne.mockResolvedValue(null);

      await svc.syncModels();

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: '' }));
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
      expect(find).toHaveBeenCalledWith({ isActive: true, type: 'chat' });
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
      expect(find).toHaveBeenCalledWith({ chefSlug: 'openai', isActive: true, type: 'chat' });
    });
  });
});
