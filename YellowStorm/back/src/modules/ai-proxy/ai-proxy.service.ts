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
import { AI_PROXY_REQUEST_TIMEOUT_MS } from './constants/ai-proxy.constants';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { LiteLlmErrorResponse, LiteLlmTokenUsage } from './interfaces/ai-proxy.interface';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';

@Injectable()
export class AiProxyService {
  private readonly appBuilderApiKey: string;

  constructor(
    private readonly connectionService: LiteLLMConnectionService,
    private readonly modelsService: ModelsService,
    private readonly configService: ConfigService,
    private readonly streamService: AiProxyStreamService,
    private readonly usageService: AiProxyUsageService,
  ) {
    this.appBuilderApiKey = this.configService.get<string>('litellm.appBuilderApiKey', '');
  }

  async proxyChatCompletion(
    body: ChatCompletionDto,
    user: UserDocument,
    request?: Request,
    res?: Response,
  ): Promise<Record<string, unknown> | void> {
    const validation = await this.modelsService.validateModelActive(body.model, 'chat');
    if (!validation.valid) {
      throw new BadRequestException(
        `Model '${body.model}' is not available`,
      );
    }

    if (body.stream) {
      if (!request || !res) {
        throw new BadRequestException('Streaming response is unavailable');
      }
      return this.streamService.streamChatCompletion(
        request,
        res,
        body,
        user,
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
      });
      throw this.mapUpstreamError(error);
    }
  }

  async listModels(): Promise<{
    object: 'list';
    data: Array<{ id: string; object: 'model'; owned_by: string }>;
  }> {
    const { models } = await this.modelsService.findAll(true, true);

    return {
      object: 'list',
      data: models.map((model) => ({
        id: model.id,
        object: 'model',
        owned_by: model.chefSlug || 'unknown',
      })),
    };
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
