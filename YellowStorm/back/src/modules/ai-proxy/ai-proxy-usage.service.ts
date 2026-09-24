import { Injectable, Optional, Inject } from '@nestjs/common';
import { Request } from 'express';
import { LoggerService } from '../logger';
import { ModelsService } from '../models/models.service';
import { UsageService, UsageType } from '../usage';
import { AppBuilderAiUsageService } from '../app-builder-ai/services/app-builder-ai-usage.service';
import { AppDataCatalogService } from '../app-data/services/app-data-catalog.service';
import { AppDataClientService } from '../app-data/services/app-data-client.service';
import {
  CONVERSATION_V2_SESSION_STORE,
  type ConversationV2SessionStore,
} from '../conversation-v2/persistence/conversation-v2-session.store';
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

type AiProxyAuthedRequest = Request & {
  aiProxyAuth?: {
    mode?: 'platform' | 'app_end_user' | 'ai_preview';
    appDataId?: string;
    endUserId?: string;
    workspaceId?: string;
  };
};

@Injectable()
export class AiProxyUsageService {
  constructor(
    private readonly usageService: UsageService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
    @Optional() private readonly appBuilderAiUsage?: AppBuilderAiUsageService,
    @Optional()
    @Inject(CONVERSATION_V2_SESSION_STORE)
    private readonly sessions?: ConversationV2SessionStore,
    @Optional() private readonly appDataCatalog?: AppDataCatalogService,
    @Optional() private readonly appDataClient?: AppDataClientService,
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
    const auth = (params.request as AiProxyAuthedRequest | undefined)?.aiProxyAuth;
    const isAppBuilder =
      auth?.mode === 'ai_preview' || auth?.mode === 'app_end_user';

    const attribution = await this.resolveAttribution(auth);
    const metadata: Record<string, unknown> = {
      tokensStatus: tokensUnknown ? 'unknown' : 'known',
      streaming: params.streaming,
      model: params.model,
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
      ...attribution,
    };

    const inputTokens = tokens.status === 'known' ? tokens.promptTokens : 0;
    const outputTokens = tokens.status === 'known' ? tokens.completionTokens : 0;
    const errorCode = params.errorMessage
      ? (params.streaming ? 'AI_PROXY_STREAM_ERROR' : 'AI_PROXY_ERROR')
      : undefined;

    try {
      if (isAppBuilder && this.appBuilderAiUsage) {
        await this.appBuilderAiUsage.recordUsage({
          userId: params.userId,
          inputTokens,
          outputTokens,
          modelName: params.model,
          durationMs: Date.now() - params.startedAt,
          ipAddress: params.request?.ip,
          userAgent: params.request?.get?.('user-agent') ?? undefined,
          success: params.success,
          errorCode,
          metadata: {
            authMode: auth?.mode,
            ...attribution,
            tokensStatus: metadata.tokensStatus,
            streaming: params.streaming,
            ...(pricing ? { pricing: metadata.pricing, estimatedCost } : {}),
          },
        });
        if (params.success) {
          await this.markSessionHasAiFeatures(attribution);
        }
        return;
      }

      await this.usageService.recordUsage({
        userId: params.userId,
        inputTokens,
        outputTokens,
        usageType: UsageType.CHAT,
        modelName: params.model,
        endpoint: AI_PROXY_CHAT_ENDPOINT,
        durationMs: Date.now() - params.startedAt,
        ipAddress: params.request?.ip,
        userAgent: params.request?.get?.('user-agent') ?? undefined,
        success: params.success,
        errorCode,
        metadata,
      });
    } catch (error) {
      this.logger.error('Failed to record AI proxy usage', {
        userId: params.userId,
        model: params.model,
        authMode: auth?.mode,
        appBuilder: isAppBuilder,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /** Runtime proof: successful App Builder proxy call ⇒ sticky hasAiFeatures. */
  private async markSessionHasAiFeatures(
    attribution: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = attribution.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || !this.sessions) return;
    try {
      await this.sessions.setAiFeaturesFlag(sessionId, true, null);
    } catch (error) {
      this.logger.warn('Failed to mark session hasAiFeatures after AI proxy usage', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async resolveAttribution(
    auth: AiProxyAuthedRequest['aiProxyAuth'] | undefined,
  ): Promise<Record<string, unknown>> {
    if (!auth) return {};
    const result: Record<string, unknown> = {};
    if (auth.appDataId) result.appDataId = auth.appDataId;
    if (auth.endUserId) result.endUserId = auth.endUserId;

    // Preview tickets carry workspaceId; deployed end-user JWTs only carry appDataId.
    let workspaceId = auth.workspaceId;
    if (!workspaceId && auth.appDataId) {
      workspaceId = (await this.resolveWorkspaceId(auth.appDataId)) ?? undefined;
    }
    if (workspaceId) result.workspaceId = workspaceId;

    if (workspaceId && this.sessions) {
      const session = await this.sessions.findByAiSessionId(workspaceId);
      if (session) {
        result.sessionId = session.id;
        result.appTitle = session.deployedAppTitle || session.title || '';
      }
    }

    return result;
  }

  /**
   * Resolve workspace for deployed apps: remote App Data microservice first,
   * then Nest-local catalog (APP_DATA_REMOTE=false).
   */
  private async resolveWorkspaceId(appDataId: string): Promise<string | null> {
    if (this.appDataClient?.isEnabled()) {
      try {
        const status = await this.appDataClient.getStatus(appDataId);
        const fromRemote = this.pickWorkspaceId(
          status.app as Record<string, unknown> | undefined,
        );
        if (fromRemote) return fromRemote;
      } catch (error) {
        this.logger.warn('Failed to resolve workspaceId via App Data client', {
          appDataId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (this.appDataCatalog) {
      try {
        const app = await this.appDataCatalog.findByAppDataId(appDataId);
        if (app?.workspaceId) return app.workspaceId;
      } catch (error) {
        this.logger.warn('Failed to resolve workspaceId via App Data catalog', {
          appDataId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return null;
  }

  private pickWorkspaceId(app: Record<string, unknown> | undefined): string | null {
    if (!app) return null;
    for (const key of ['workspaceId', 'workspace_id'] as const) {
      const value = app[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }
}
