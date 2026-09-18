import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { UserDocument } from '../user/schemas/user.schema';
import {
  BadRequestException,
  BadGatewayException,
  ServiceUnavailableException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import { ModelResponse } from '../models/interfaces/model.interface';
import { AI_PROXY_REQUEST_TIMEOUT_MS } from './constants/ai-proxy.constants';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { LiteLlmErrorResponse, LiteLlmTokenUsage } from './interfaces/ai-proxy.interface';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';

@Injectable()
export class AiProxyService {
  private readonly appBuilderApiKey: string;
  private readonly allowedModels: Set<string>;
  private readonly maxTokensPerRequest: number;
  private readonly maxBodyBytes: number;
  private readonly maxMessages: number;
  private readonly maxMessageContentChars: number;

  constructor(
    private readonly connectionService: LiteLLMConnectionService,
    private readonly modelsService: ModelsService,
    private readonly configService: ConfigService,
    private readonly streamService: AiProxyStreamService,
    private readonly usageService: AiProxyUsageService,
  ) {
    this.appBuilderApiKey = this.configService.get<string>('litellm.appBuilderApiKey', '');
    this.allowedModels = new Set(
      this.configService.get<string[]>('aiProxy.allowedModels', []),
    );
    this.maxTokensPerRequest = this.configService.get<number>(
      'aiProxy.maxTokensPerRequest',
      4096,
    );
    this.maxBodyBytes = this.configService.get<number>(
      'aiProxy.maxBodyBytes',
      1_048_576,
    );
    this.maxMessages = this.configService.get<number>('aiProxy.maxMessages', 100);
    this.maxMessageContentChars = this.configService.get<number>(
      'aiProxy.maxMessageContentChars',
      100_000,
    );
  }

  async proxyChatCompletion(
    body: ChatCompletionDto,
    user: UserDocument,
    request?: Request,
    res?: Response,
  ): Promise<Record<string, unknown> | void> {
    this.validateRequestLimits(body);

    const validation = await this.modelsService.validateModelActive(body.model, 'chat');
    if (!validation.valid || (
      this.allowedModels.size > 0 && !this.allowedModels.has(body.model)
    )) {
      throw new BadRequestException(
        `Model '${body.model}' is not available`,
      );
    }

    this.normalizeSamplingParams(body, validation.model);

    const pricing = await this.usageService.resolvePricing(body.model);

    if (body.stream) {
      if (!request || !res) {
        throw new BadRequestException('Streaming response is unavailable');
      }
      return this.streamService.streamChatCompletion(
        request,
        res,
        body,
        user,
        pricing,
      );
    }

    const httpClient = this.connectionService.getHttpClient();
    if (!httpClient || !this.appBuilderApiKey) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    const startedAt = Date.now();
    try {
      const upstreamResponse = await httpClient.post<Record<string, unknown>>(
        '/v1/chat/completions',
        { ...body, stream: false },
        {
          headers: {
            Authorization: `Bearer ${this.appBuilderApiKey}`,
            'X-Request-User': user._id.toString(),
          },
          timeout: AI_PROXY_REQUEST_TIMEOUT_MS,
        },
      );

      const data = upstreamResponse.data;
      await this.usageService.recordChatCompletionUsage({
        userId: user._id.toString(),
        model: body.model,
        request,
        startedAt,
        success: true,
        tokens: this.usageService.resolveTokens(data.usage as LiteLlmTokenUsage | undefined),
        streaming: false,
        litellmRequestId: typeof data.id === 'string' ? data.id : undefined,
        pricing,
      });
      return data;
    } catch (error) {
      await this.usageService.recordChatCompletionUsage({
        userId: user._id.toString(),
        model: body.model,
        request,
        startedAt,
        success: false,
        tokens: { status: 'unknown' },
        streaming: false,
        errorMessage: error instanceof Error ? error.message : 'AI provider request failed',
        pricing,
      });
      throw this.mapUpstreamError(error);
    }
  }

  async listModels(): Promise<{
    object: 'list';
    data: Array<{ id: string; object: 'model'; owned_by: string }>;
  }> {
    const { models } = await this.modelsService.findAll(true, true);
    const visibleModels = this.allowedModels.size > 0
      ? models.filter((model) => this.allowedModels.has(model.id))
      : models;

    // Platform default first so clients that pick data[0] get a valid model.
    const ordered = [...visibleModels].sort((a, b) => {
      if (a.isDefault === b.isDefault) return 0;
      return a.isDefault ? -1 : 1;
    });

    return {
      object: 'list',
      data: ordered.map((model) => ({
        id: model.id,
        object: 'model' as const,
        owned_by: model.chefSlug || 'unknown',
      })),
    };
  }

  private validateRequestLimits(body: ChatCompletionDto): void {
    if (body.messages.length > this.maxMessages) {
      throw new BadRequestException(
        `Too many messages. Maximum allowed is ${this.maxMessages}.`,
      );
    }

    const serializedBodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (serializedBodyBytes > this.maxBodyBytes) {
      throw new BadRequestException(
        `Request body is too large. Maximum allowed is ${this.maxBodyBytes} bytes.`,
      );
    }

    for (const message of body.messages) {
      if (message.content.length > this.maxMessageContentChars) {
        throw new BadRequestException(
          `Message content is too large. Maximum allowed is ${this.maxMessageContentChars} characters.`,
        );
      }
    }

    const requestedTokens = Math.max(
      body.max_tokens ?? 0,
      body.max_completion_tokens ?? 0,
    );
    if (requestedTokens > this.maxTokensPerRequest) {
      throw new BadRequestException(
        `Requested tokens exceed the maximum of ${this.maxTokensPerRequest}.`,
      );
    }
  }

  /**
   * Align sampling/token params with model capabilities before LiteLLM.
   * Reasoning / gpt-5 family: no temperature; prefer max_completion_tokens
   * (max_tokens alone often yields empty assistant content).
   */
  private normalizeSamplingParams(
    body: ChatCompletionDto,
    model: ModelResponse | null,
  ): void {
    const reasoningSafe = this.isReasoningSafeModel(body.model, model);

    if (reasoningSafe && body.temperature !== undefined) {
      delete body.temperature;
    }

    if (reasoningSafe) {
      const cap = body.max_completion_tokens ?? body.max_tokens ?? this.maxTokensPerRequest;
      body.max_completion_tokens = cap;
      delete body.max_tokens;
      return;
    }

    const hasTokenCap = body.max_tokens != null || body.max_completion_tokens != null;
    if (!hasTokenCap) {
      body.max_tokens = this.maxTokensPerRequest;
    }
  }

  private isReasoningSafeModel(modelId: string, model: ModelResponse | null): boolean {
    if (model?.omitTemperature === true) return true;
    if (model?.supportsReasoning === true) return true;
    const haystack = `${modelId} ${model?.litellmModel ?? ''}`.toLowerCase();
    return /gpt-5|o1|o3|o4|reasoning/.test(haystack);
  }

  private mapUpstreamError(error: unknown): Error {
    if (!(error instanceof AxiosError)) {
      return new BadGatewayException(
        ErrorCode.CHAT_COMPLETION_FAILED,
        'AI provider request failed',
      );
    }

    const upstreamMessage = (error.response?.data as LiteLlmErrorResponse | undefined)
      ?.error?.message;
    if (!error.response || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    return new BadGatewayException(
      ErrorCode.CHAT_COMPLETION_FAILED,
      upstreamMessage || 'AI provider request failed',
    );
  }
}
