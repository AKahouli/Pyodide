import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LoggerService } from '../logger';

/**
 * Computes text embeddings via the shared LiteLLM proxy (`/v1/embeddings`).
 *
 * Self-contained (builds its own HTTP call from `litellm.*` config) so it can be
 * provided by a lightweight global module without importing ModelsModule — which
 * would drag AuthorizationModule/UserModule into the early global-load phase and
 * break the app's module load order. Resilient by design: returns `null` (never
 * throws) when unconfigured or the call fails.
 */
@Injectable()
export class EmbeddingService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EmbeddingService.name);
  }

  async embed(text: string): Promise<number[] | null> {
    const base = (this.config.get<string>('litellm.apiUrl') || '').replace(/\/$/, '');
    if (!base) {
      this.logger.warn('Embedding skipped: LiteLLM API URL not configured');
      return null;
    }
    try {
      const endpoint = this.config.get<string>('litellm.embeddingsEndpoint', '/v1/embeddings');
      const model = this.config.get<string>('litellm.embeddingModel')!;
      const dimensions = this.config.get<number>('litellm.embeddingDimension')!;
      const timeout = this.config.get<number>('litellm.timeoutMs', 10000);
      const apiKey = this.config.get<string>('litellm.apiKey') || '';
      const res = await axios.post(
        `${base}${endpoint}`,
        { model, input: text, dimensions },
        { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeout },
      );
      const vec = res.data?.data?.[0]?.embedding;
      return Array.isArray(vec) ? (vec as number[]) : null;
    } catch (error) {
      this.logger.error('Embedding request failed', { error: (error as Error).message });
      return null;
    }
  }
}
