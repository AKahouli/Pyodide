import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ServiceUnavailableException } from '@modules/exceptions';
import { SemanticAgeGraphRepository } from '../repositories/semantic-age-graph.repository';

@Injectable()
export class SemanticSearchGraphClient {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly ageGraph: SemanticAgeGraphRepository,
  ) {}

  async index(modelId: string): Promise<void> {
    const token = this.config.semanticSearchToken.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'SEMANTIC_SEARCH_TOKEN is required to index the semantic graph',
      );
    }

    const baseUrl = this.config.semanticSearchUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${baseUrl}/v1/graphs/index`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schema_name: this.ageGraph.graphNameForModel(modelId),
        }),
        signal: AbortSignal.timeout(this.config.semanticSearchTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`Semantic graph indexing returned HTTP ${res.status}`);
      }
    } catch {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Semantic graph indexing is unavailable',
      );
    }
  }
}
