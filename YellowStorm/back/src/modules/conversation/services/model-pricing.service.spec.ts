import { ModelPricingService } from './model-pricing.service';

describe('ModelPricingService', () => {
  it('prices regular, cached input, and output tokens independently', async () => {
    const models = {
      findPricing: jest.fn().mockResolvedValue({
        provider: 'openai',
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
        cachedInputCostPerToken: 0.0000005,
        version: 'litellm:v1',
      }),
    };
    const service = new ModelPricingService(models as never);

    const result = await service.estimate('model-1', {
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
      reasoningTokens: 0,
      totalTokens: 120,
    });

    expect(result).toMatchObject({ provider: 'openai', version: 'litellm:v1' });
    expect(result.usd).toBeCloseTo(0.00012);
  });

  it('returns null rather than zero for an unknown model', async () => {
    const service = new ModelPricingService({
      findPricing: jest.fn().mockResolvedValue(null),
    } as never);
    await expect(
      service.estimate('unknown', {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 2,
      }),
    ).resolves.toEqual({ usd: null, version: null });
  });
});
