import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { LoggerService } from '../logger';
import { ModelsService } from '../models/models.service';
import { UsageService, UsageType } from '../usage';
import { AI_PROXY_CHAT_ENDPOINT } from './constants/ai-proxy.constants';
import {
  AiProxyModelPricing,
  AiProxyResolvedTokens,
  LiteLlmTokenUsage,
} from './interfaces/ai-proxy.interface';

export interface RecordAiProxyUsageParams {
  userId: string;
  model: string;
  request?: Request;
  startedAt: number;
  success: boolean;
  tokens: AiProxyResolvedTokens;
  streaming: boolean;
  litellmRequestId?: string;
  errorMessage?: string;
  pricing?: AiProxyModelPricing | null;
}

@Injectable()
export class AiProxyUsageService {
  constructor(
    private readonly usageService: UsageService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
  ) {}

  resolveTokens(usage?: LiteLlmTokenUsage | null): AiProxyResolvedTokens {
    if (
      !usage
      || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)
    ) {
      return { status: 'unknown' };
    }

    return {
      status: 'known',
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens,
    };
  }

  estimateCost(
    tokens: AiProxyResolvedTokens,
    pricing?: AiProxyModelPricing | null,
  ): number | null {
    if (tokens.status !== 'known' || !pricing) {
      return null;
    }
    const inputRate = pricing.inputCostPerToken;
    const outputRate = pricing.outputCostPerToken;
    if (inputRate == null && outputRate == null) {
      return null;
    }
    return (
      tokens.promptTokens * (inputRate ?? 0)
      + tokens.completionTokens * (outputRate ?? 0)
    );
  }

  async resolvePricing(modelId: string): Promise<AiProxyModelPricing | null> {
    const pricing = await this.modelsService.findPricing(modelId);
    if (!pricing) return null;
    return {
      provider: pricing.provider,
      inputCostPerToken: pricing.inputCostPerToken,
      outputCostPerToken: pricing.outputCostPerToken,
      cachedInputCostPerToken: pricing.cachedInputCostPerToken,
      version: pricing.version,
    };
  }

  async recordChatCompletionUsage(params: RecordAiProxyUsageParams): Promise<void> {
    const tokens = params.tokens;
    const tokensUnknown = tokens.status === 'unknown';
    if (tokensUnknown && params.success) {
      this.logger.warn('AI proxy usage tokens unavailable from LiteLLM', {
        userId: params.userId,
        model: params.model,
        streaming: params.streaming,
      });
    }

    const pricing = params.pricing === undefined
      ? await this.resolvePricing(params.model)
      : params.pricing;
    const estimatedCost = this.estimateCost(tokens, pricing);

    const metadata: Record<string, unknown> = {
      tokensStatus: tokensUnknown ? 'unknown' : 'known',
      streaming: params.streaming,
      ...(params.litellmRequestId ? { litellmRequestId: params.litellmRequestId } : {}),
      ...(params.errorMessage ? { error: params.errorMessage } : {}),
      ...(pricing
        ? {
            pricing: {
              provider: pricing.provider,
              inputCostPerToken: pricing.inputCostPerToken,
              outputCostPerToken: pricing.outputCostPerToken,
              cachedInputCostPerToken: pricing.cachedInputCostPerToken,
              version: pricing.version,
            },
            estimatedCost,
          }
        : {}),
    };

    try {
      await this.usageService.recordUsage({
        userId: params.userId,
        inputTokens: tokens.status === 'known' ? tokens.promptTokens : 0,
        outputTokens: tokens.status === 'known' ? tokens.completionTokens : 0,
        usageType: UsageType.CHAT,
        modelName: params.model,
        endpoint: AI_PROXY_CHAT_ENDPOINT,
        durationMs: Date.now() - params.startedAt,
        ipAddress: params.request?.ip,
        userAgent: params.request?.get?.('user-agent') ?? undefined,
        success: params.success,
        errorCode: params.errorMessage
          ? (params.streaming ? 'AI_PROXY_STREAM_ERROR' : 'AI_PROXY_ERROR')
          : undefined,
        metadata,
      });
    } catch (error) {
      this.logger.warn('Failed to record AI proxy usage', {
        userId: params.userId,
        model: params.model,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
