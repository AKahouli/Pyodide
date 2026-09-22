import { describe, expect, it } from 'vitest';
import { formatCarbon, formatCompactTokenTotal, formatUsd } from './usage-format';

describe('conversation usage formatting', () => {
  it('formats compact totals and estimates without hiding small costs', () => {
    expect(formatCompactTokenTotal(128_734, 'en')).toBe('128.7K tokens');
    expect(formatCompactTokenTotal(1_250_000, 'en')).toBe('1.3M tokens');
    expect(formatUsd(0.287, 'en')).toBe('$0.287');
    expect(formatUsd(0.0004, 'en')).toBe('<$0.001');
    expect(formatCarbon(6.2, 'en')).toBe('≈ 6.2 gCO₂e');
    expect(formatCarbon(1_300, 'en')).toBe('≈ 1.3 kgCO₂e');
  });
});
