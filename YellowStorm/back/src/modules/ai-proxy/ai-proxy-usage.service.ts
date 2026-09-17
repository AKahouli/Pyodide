import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { LoggerService } from '../logger';
import { UsageService, UsageType } from '../usage';
import { AI_PROXY_CHAT_ENDPOINT } from './constants/ai-proxy.constants';
import {
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
}

@Injectable()
export class AiProxyUsageService {
  constructor(
    private readonly usageService: UsageService,
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

    const metadata: Record<string, unknown> = {
      tokensStatus: tokensUnknown ? 'unknown' : 'known',
      streaming: params.streaming,
      ...(params.litellmRequestId ? { litellmRequestId: params.litellmRequestId } : {}),
      ...(params.errorMessage ? { error: params.errorMessage } : {}),
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
