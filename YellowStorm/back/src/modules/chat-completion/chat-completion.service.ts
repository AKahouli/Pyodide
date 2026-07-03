import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { LoggerService } from '../logger';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import {
  BadRequestException,
  InternalServerException,
  ServiceUnavailableException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  ChatMessage,
  CompletionRequest,
  CompletionOptions,
  CompletionResult,
  LiteLLMChatCompletionResponse,
} from './interfaces/chat-completion.interface';

/** Timeout for chat completion requests (60s) */
const COMPLETION_TIMEOUT_MS = 360_000;

const DEFAULT_TEMPERATURE = 0;

@Injectable()
export class ChatCompletionService {
  constructor(
    private readonly connectionService: LiteLLMConnectionService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ChatCompletionService.name);
  }

  /**
   * Main completion method — sends messages to LiteLLM /v1/chat/completions.
   * Callers provide all configuration per-request.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const httpClient = this.connectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE);
    }

    // Resolve model
    const resolved = await this.resolveModel(request.modelId);

    // Build final messages with optional system prompt
    const finalMessages: ChatMessage[] = request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
      : [...request.messages];

    const temperature = request.temperature ?? DEFAULT_TEMPERATURE;

    // gpt-5 family models (gpt-5, gpt-5-codex, gpt-5.x nano/mini/…) reject any
    // temperature other than 1 → LiteLLM returns 400 UnsupportedParamsError.
    // Omit the param entirely for them so the server applies its default (1)
    // instead of failing. Detect via both the model id and the LiteLLM
    // deployment string so either naming ("gpt-5.4-nano") matches.
    const supportsTemperature = !/gpt-5/i.test(
      `${resolved.modelId} ${resolved.litellmModel}`,
    );

    const startTime = Date.now();

    try {
      const response = await httpClient.post<LiteLLMChatCompletionResponse>(
        '/v1/chat/completions',
        {
          model: resolved.modelId,
          messages: finalMessages,
          //max_tokens: maxTokens,
          ...(supportsTemperature ? { temperature } : {}),
          stream: false,
        },
        { timeout: COMPLETION_TIMEOUT_MS },
      );

      const latencyMs = Date.now() - startTime;
      const data = response.data;
      const content = data.choices?.[0]?.message?.content ?? '';

      const result: CompletionResult = {
        content,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        model: data.model ?? resolved.litellmModel,
        latencyMs,
      };

      this.logger.log('Chat completion request succeeded', {
        model: resolved.litellmModel,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs,
      });

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof AxiosError) {
        const status = error.response?.status;
        const errorMsg = error.response?.data?.error?.message ?? error.message;

        this.logger.error('Chat completion request failed', {
          model: resolved.litellmModel,
          status,
          error: errorMsg,
          latencyMs,
        });

        if (!error.response || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          throw new ServiceUnavailableException(ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE);
        }
      }

      throw new InternalServerException(
        error instanceof Error ? error : undefined,
        ErrorCode.CHAT_COMPLETION_FAILED,
      );
    }
  }

  /**
   * Convenience method — text in, text out.
   * Wraps the prompt as a user message, sends with provided options.
   */
  async completeText(prompt: string, options: CompletionOptions): Promise<string> {
    const result = await this.complete({
      messages: [{ role: 'user', content: prompt }],
      modelId: options.modelId,
      temperature: options.temperature,
      systemPrompt: options.systemPrompt,
    });
    return result.content;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async resolveModel(
    modelId: string,
  ): Promise<{ modelId: string; litellmModel: string }> {
    const model = await this.modelsService.findById(modelId);

    if (!model || !model.litellmModel) {
      throw new BadRequestException(ErrorCode.CHAT_COMPLETION_MODEL_NOT_FOUND);
    }
    return { modelId: model.id, litellmModel: model.litellmModel };
  }
}
