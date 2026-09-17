import { UsageService } from '../usage';
import { LoggerService } from '../logger';
import { ModelsService } from '../models/models.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';

describe('AiProxyUsageService', () => {
  const usageService = {
    recordUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as UsageService;
  const modelsService = {
    findPricing: jest.fn(),
  } as unknown as jest.Mocked<ModelsService>;
  const logger = {
    warn: jest.fn(),
  } as unknown as LoggerService;

  const createService = () => new AiProxyUsageService(usageService, modelsService, logger);

  beforeEach(() => {
    jest.clearAllMocks();
    modelsService.findPricing.mockResolvedValue({
      provider: 'openai',
      inputCostPerToken: 0.000001,
      outputCostPerToken: 0.000002,
      cachedInputCostPerToken: null,
      version: 'litellm:test',
    });
  });

  it('resolves known and unknown token payloads', () => {
    const service = createService();

    expect(service.resolveTokens(undefined)).toEqual({ status: 'unknown' });
    expect(service.resolveTokens({})).toEqual({ status: 'unknown' });
    expect(service.resolveTokens({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      status: 'known',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: undefined,
    });
  });

  it('estimates cost from ModelsService pricing', () => {
    const service = createService();
    expect(service.estimateCost(
      { status: 'known', promptTokens: 10, completionTokens: 5 },
      { inputCostPerToken: 0.000001, outputCostPerToken: 0.000002 },
    )).toBeCloseTo(0.00002);
    expect(service.estimateCost({ status: 'unknown' }, {
      inputCostPerToken: 0.000001,
      outputCostPerToken: 0.000002,
    })).toBeNull();
  });

  it('records known tokens with pricing metadata from ModelsService', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'known', promptTokens: 1, completionTokens: 2 },
      streaming: false,
      litellmRequestId: 'chatcmpl-1',
    });

    expect(modelsService.findPricing).toHaveBeenCalledWith('gpt-4o');
    expect(usageService.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 1,
        outputTokens: 2,
        metadata: expect.objectContaining({
          tokensStatus: 'known',
          litellmRequestId: 'chatcmpl-1',
          streaming: false,
          estimatedCost: expect.any(Number),
          pricing: expect.objectContaining({
            provider: 'openai',
            inputCostPerToken: 0.000001,
            outputCostPerToken: 0.000002,
          }),
        }),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('marks missing stream tokens as unknown instead of silent zero usage', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'unknown' },
      streaming: true,
      pricing: null,
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(modelsService.findPricing).not.toHaveBeenCalled();
    expect(usageService.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
        metadata: expect.objectContaining({
          tokensStatus: 'unknown',
          streaming: true,
        }),
      }),
    );
  });
});
