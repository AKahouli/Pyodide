import { Injectable } from '@nestjs/common';
import { CarbonEstimatorService } from './carbon-estimator.service';
import { ModelPricingService } from './model-pricing.service';
import type { ConversationUsageAttribution, ConversationUsageEventInput } from '../utils/usage-metrics';

@Injectable()
export class ConversationUsageAccountingService {
  constructor(
    private readonly pricing: ModelPricingService,
    private readonly carbon: CarbonEstimatorService,
  ) {}

  async createEvents(conversationId: string, messageId: string, attribution: ConversationUsageAttribution): Promise<ConversationUsageEventInput[]> {
    return Promise.all(
      attribution.entries.map(async (entry) => {
        const price = await this.pricing.estimate(entry.model, entry);
        const carbon = this.carbon.estimate(price.provider, entry.model, entry);
        return {
          ...entry,
          eventKey: `${attribution.executionId}:${entry.agentId ?? ''}:${entry.model}`,
          conversationId,
          messageId,
          executionId: attribution.executionId,
          provider: price.provider,
          costUsd: price.usd,
          pricingVersion: price.version,
          carbonGramsCo2e: carbon.gramsCo2e,
          carbonMethodology: carbon.methodology,
          carbonFactorVersion: carbon.factorVersion,
        };
      }),
    );
  }
}
