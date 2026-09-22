import { Injectable } from '@nestjs/common';
import { ModelsService } from '@modules/models/models.service';
import type { NormalizedTokenUsage } from '../utils/usage-metrics';

export interface PriceEstimate {
  provider?: string;
  usd: number | null;
  version: string | null;
}

@Injectable()
export class ModelPricingService {
  constructor(private readonly modelsService: ModelsService) {}

  async estimate(model: string, usage: NormalizedTokenUsage): Promise<PriceEstimate> {
    const pricing = await this.modelsService.findPricing(model);
    if (!pricing) return { usd: null, version: null };
    const regularInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    const cachedRate = pricing.cachedInputCostPerToken ?? pricing.inputCostPerToken;
    if ((regularInputTokens > 0 && pricing.inputCostPerToken == null) || (usage.cachedInputTokens > 0 && cachedRate == null) || (usage.outputTokens > 0 && pricing.outputCostPerToken == null)) {
      return { provider: pricing.provider, usd: null, version: pricing.version };
    }
    return {
      provider: pricing.provider,
      usd: regularInputTokens * (pricing.inputCostPerToken ?? 0) + usage.cachedInputTokens * (cachedRate ?? 0) + usage.outputTokens * (pricing.outputCostPerToken ?? 0),
      version: pricing.version,
    };
  }
}
