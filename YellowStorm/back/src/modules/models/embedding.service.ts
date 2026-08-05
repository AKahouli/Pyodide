import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { LiteLLMConnectionService } from './litellm-connection.service';

/**
 * Computes text embeddings via the shared LiteLLM proxy (`/v1/embeddings`).
 * Resilient by design: returns `null` (never throws) when the proxy is
 * unconfigured or the call fails, so callers can degrade gracefully.
 */
@Injectable()
export class EmbeddingService {
  constructor(
    private readonly connection: LiteLLMConnectionService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EmbeddingService.name);
  }

  async embed(text: string): Promise<number[] | null> {
    const client = this.connection.getHttpClient();
    if (!client) {
      this.logger.warn('Embedding skipped: LiteLLM client not configured');
      return null;
    }
    try {
      const endpoint = this.config.get<string>('litellm.embeddingsEndpoint', '/v1/embeddings');
      const model = this.config.get<string>('litellm.embeddingModel')!;
      const dimensions = this.config.get<number>('litellm.embeddingDimension')!;
      const res = await client.post(endpoint, { model, input: text, dimensions });
      const vec = res.data?.data?.[0]?.embedding;
      return Array.isArray(vec) ? (vec as number[]) : null;
    } catch (error) {
      this.logger.error('Embedding request failed', { error: (error as Error).message });
      return null;
    }
  }
}
