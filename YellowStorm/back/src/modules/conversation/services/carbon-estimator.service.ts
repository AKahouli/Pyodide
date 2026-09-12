import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NormalizedTokenUsage } from '../utils/usage-metrics';

const DEFAULT_GRAMS_CO2E_PER_1K_TOKENS = 0.15;
const DEFAULT_FACTOR_VERSION = 'baseline-2026-09';

export interface CarbonEstimate {
  gramsCo2e: number | null;
  estimated: true;
  methodology: string;
  factorVersion: string;
}

@Injectable()
export class CarbonEstimatorService {
  private readonly factors: Record<string, number>;

  constructor(private readonly config: ConfigService) {
    this.factors = this.parseFactors(config.get<string>('conversation.carbonFactorsJson', '{}'));
  }

  estimate(provider: string | undefined, model: string, usage: NormalizedTokenUsage): CarbonEstimate {
    const configuredFactor = this.factors[`${provider ?? ''}/${model}`] ?? this.factors[model] ?? (provider ? this.factors[provider] : undefined) ?? this.factors.default;
    // ponytail: baseline estimate keeps the metric useful; configure model factors when measured data is available.
    const factor = configuredFactor ?? DEFAULT_GRAMS_CO2E_PER_1K_TOKENS;
    return {
      gramsCo2e: (usage.totalTokens / 1_000) * factor,
      estimated: true,
      methodology: this.config.get<string>('conversation.carbonMethodology', 'tokens-factor-v1'),
      factorVersion: configuredFactor == null ? DEFAULT_FACTOR_VERSION : this.config.get<string>('conversation.carbonFactorVersion', 'configured'),
    };
  }

  private parseFactors(value: string): Record<string, number> {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0));
    } catch {
      return {};
    }
  }
}
