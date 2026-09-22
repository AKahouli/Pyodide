import { CarbonEstimatorService } from './carbon-estimator.service';

describe('CarbonEstimatorService', () => {
  const usage = {
    inputTokens: 80,
    outputTokens: 20,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 100,
  };

  it('uses the provider/model factor and exposes its methodology version', () => {
    const config = {
      get: jest.fn(
        (key: string, fallback?: string) =>
          ({
            'conversation.carbonFactorsJson': '{"openai/model-1":2}',
            'conversation.carbonMethodology': 'tokens-factor-v1',
            'conversation.carbonFactorVersion': '2026-09',
          })[key] ?? fallback,
      ),
    };
    const service = new CarbonEstimatorService(config as never);
    expect(service.estimate('openai', 'model-1', usage)).toEqual({
      gramsCo2e: 0.2,
      estimated: true,
      methodology: 'tokens-factor-v1',
      factorVersion: '2026-09',
    });
  });

  it('uses the baseline estimate when no factor is configured', () => {
    const service = new CarbonEstimatorService({
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as never);
    expect(service.estimate('openai', 'unknown', usage)).toEqual({
      gramsCo2e: 0.015,
      estimated: true,
      methodology: 'tokens-factor-v1',
      factorVersion: 'baseline-2026-09',
    });
  });
});
