import { normalizeTokenUsage } from './usage-metrics';

describe('normalizeTokenUsage', () => {
  it('keeps cached and reasoning tokens as included breakdowns', () => {
    expect(
      normalizeTokenUsage({
        inputTokens: 100,
        outputTokens: 40,
        cachedInputTokens: 30,
        reasoningTokens: 10,
        totalTokens: 140,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 140,
    });
  });

  it('does not allow provider breakdowns to inflate totals', () => {
    expect(
      normalizeTokenUsage({
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 20,
        reasoningTokens: 20,
      }),
    ).toMatchObject({ cachedInputTokens: 10, reasoningTokens: 5, totalTokens: 15 });
  });
});
