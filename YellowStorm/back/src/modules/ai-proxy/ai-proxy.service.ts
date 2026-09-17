import { Injectable } from '@nestjs/common';
import { AxiosError, AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { UserDocument } from '../user/schemas/user.schema';
import {
  BadRequestException,
  BadGatewayException,
  ServiceUnavailableException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import { ChatCompletionDto } from './dto/chat-completion.dto';

interface LiteLlmErrorResponse {
  error?: {
    message?: string;
  };
}

@Injectable()
export class AiProxyService {
  private readonly appBuilderApiKey: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly connectionService: LiteLLMConnectionService,
    private readonly modelsService: ModelsService,
    private readonly configService: ConfigService,
  ) {
    this.appBuilderApiKey = this.configService.get<string>('litellm.appBuilderApiKey', '');
    this.timeoutMs = this.configService.get<number>('litellm.timeoutMs', 10000);
  }

  async proxyChatCompletion(
    body: ChatCompletionDto,
    user: UserDocument,
  ): Promise<Record<string, unknown>> {
    if (body.stream) {
      throw new BadRequestException(
        'Streaming is not available on this endpoint yet',
      );
    }

    const validation = await this.modelsService.validateModelActive(body.model, 'chat');
    if (!validation.valid) {
      throw new BadRequestException(
        `Model '${body.model}' is not available`,
      );
    }

    const httpClient = this.connectionService.getHttpClient();
    if (!httpClient || !this.appBuilderApiKey) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      );
    }

    try {
      const response = await httpClient.post<Record<string, unknown>>(
        '/v1/chat/completions',
        { ...body, stream: false },
        {
          headers: {
            Authorization: `Bearer ${this.appBuilderApiKey}`,
            'X-Request-User': user._id.toString(),
          },
          timeout: this.timeoutMs,
        },
      );

      return response.data;
    } catch (error) {
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
