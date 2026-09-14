import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
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
      await axios.post(`${baseUrl}/v1/graphs/index`, {
        schema_name: this.ageGraph.graphNameForModel(modelId),
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.config.semanticSearchTimeoutMs,
      });
    } catch {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Semantic graph indexing is unavailable',
      );
    }
  }
}
