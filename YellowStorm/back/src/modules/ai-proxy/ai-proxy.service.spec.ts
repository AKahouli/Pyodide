import { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AiProxyService } from './ai-proxy.service';
import { AI_PROXY_REQUEST_TIMEOUT_MS } from './constants/ai-proxy.constants';
import { ChatCompletionDto, ChatMessageRole } from './dto/chat-completion.dto';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import { UserDocument } from '../user/schemas/user.schema';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';

describe('AiProxyService', () => {
  const post = jest.fn();
  const modelsService = {
    validateModelActive: jest.fn(),
    findAll: jest.fn(),
  } as unknown as jest.Mocked<ModelsService>;
  const connectionService = {
    getHttpClient: jest.fn(),
  } as unknown as jest.Mocked<LiteLLMConnectionService>;
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;
  const user = { _id: { toString: () => 'user-123' } } as unknown as UserDocument;
  const streamService = {
    streamChatCompletion: jest.fn(),
  } as unknown as AiProxyStreamService;
  const pricing = {
    provider: 'openai',
    inputCostPerToken: 0.000001,
    outputCostPerToken: 0.000002,
  };
  const usageService = {
    resolveTokens: jest.fn((usage?: { prompt_tokens?: number; completion_tokens?: number }) => {
      if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) {
        return { status: 'unknown' as const };
      }
      return {
        status: 'known' as const,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      };
    }),
    resolvePricing: jest.fn().mockResolvedValue(pricing),
    recordChatCompletionUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as AiProxyUsageService;
  const body: ChatCompletionDto = {
    model: 'gpt-4o',
    messages: [{ role: ChatMessageRole.USER, content: 'Hello' }],
    stream: false,
  };

  const createService = () =>
    new AiProxyService(
      connectionService,
      modelsService,
      configService,
      streamService,
      usageService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => (
      key === 'litellm.appBuilderApiKey' ? 'app-builder-key' : fallback
    ));
    connectionService.getHttpClient.mockReturnValue({ post } as unknown as AxiosInstance);
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: null,
      inactive: false,
      unsupported: false,
    });
    (usageService.resolvePricing as jest.Mock).mockResolvedValue(pricing);
    post.mockResolvedValue({
      data: {
        id: 'chatcmpl-1',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });
  });

  it('forwards non-streaming requests and injects default max_tokens when omitted', async () => {
    await expect(createService().proxyChatCompletion({ ...body }, user)).resolves.toEqual({
      id: 'chatcmpl-1',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    expect(modelsService.validateModelActive).toHaveBeenCalledWith('gpt-4o', 'chat');
    expect(post).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({
        model: 'gpt-4o',
        stream: false,
        max_tokens: 4096,
      }),
      {
        headers: {
          Authorization: 'Bearer app-builder-key',
          'X-Request-User': 'user-123',
        },
        timeout: AI_PROXY_REQUEST_TIMEOUT_MS,
      },
    );
    expect(usageService.recordChatCompletionUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        model: 'gpt-4o',
        success: true,
        streaming: false,
        litellmRequestId: 'chatcmpl-1',
        tokens: { status: 'known', promptTokens: 10, completionTokens: 5 },
        pricing,
      }),
    );
  });

  it('records unknown tokens when LiteLLM omits usage', async () => {
    post.mockResolvedValue({ data: { id: 'chatcmpl-2' } });

    await createService().proxyChatCompletion({ ...body }, user);

    expect(usageService.recordChatCompletionUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: { status: 'unknown' },
        litellmRequestId: 'chatcmpl-2',
        pricing,
      }),
    );
  });

  it('records a failed usage event when upstream fails', async () => {
    post.mockRejectedValue(new Error('upstream down'));

    await expect(createService().proxyChatCompletion({ ...body }, user)).rejects.toThrow();

    expect(usageService.recordChatCompletionUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        tokens: { status: 'unknown' },
        streaming: false,
        pricing,
      }),
    );
  });

  it('delegates streaming requests to AiProxyStreamService with pricing', async () => {
    const request = {} as Request;
    const response = {} as Response;
    (streamService.streamChatCompletion as jest.Mock).mockResolvedValue(undefined);

    const streamingBody = { ...body, stream: true };
    await expect(
      createService().proxyChatCompletion(streamingBody, user, request, response),
    ).resolves.toBeUndefined();

    expect(streamService.streamChatCompletion).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({ stream: true, max_tokens: 4096 }),
      user,
      pricing,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects streaming when request or response context is missing', async () => {
    await expect(
      createService().proxyChatCompletion({ ...body, stream: true }, user),
    ).rejects.toThrow('Streaming response is unavailable');

    expect(modelsService.validateModelActive).toHaveBeenCalledWith('gpt-4o', 'chat');
    expect(streamService.streamChatCompletion).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects inactive or unsupported models before calling LiteLLM', async () => {
    modelsService.validateModelActive.mockResolvedValue({
      valid: false,
      model: null,
      inactive: false,
      unsupported: true,
    });

    await expect(createService().proxyChatCompletion({ ...body }, user)).rejects.toThrow(
      "Model 'gpt-4o' is not available",
    );

    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed when the app builder key is not configured', async () => {
    (configService.get as jest.Mock).mockImplementation((_key: string, fallback?: unknown) => fallback);

    await expect(createService().proxyChatCompletion({ ...body }, user)).rejects.toThrow(
      'LiteLLM',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a model outside the configured allowlist', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'litellm.appBuilderApiKey') return 'app-builder-key';
      if (key === 'aiProxy.allowedModels') return ['claude-sonnet'];
      return fallback;
    });

    await expect(createService().proxyChatCompletion({ ...body }, user)).rejects.toThrow(
      "Model 'gpt-4o' is not available",
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects requests that exceed the token limit', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'litellm.appBuilderApiKey') return 'app-builder-key';
      if (key === 'aiProxy.maxTokensPerRequest') return 100;
      return fallback;
    });

    await expect(
      createService().proxyChatCompletion({ ...body, max_tokens: 101 }, user),
    ).rejects.toThrow('Requested tokens exceed');
    expect(modelsService.validateModelActive).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects requests with too many messages', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'litellm.appBuilderApiKey') return 'app-builder-key';
      if (key === 'aiProxy.maxMessages') return 1;
      return fallback;
    });

    await expect(
      createService().proxyChatCompletion({
        ...body,
        messages: [
          ...body.messages,
          { role: ChatMessageRole.USER, content: 'Second' },
        ],
      }, user),
    ).rejects.toThrow('Too many messages');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a request body over the configured byte limit', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'litellm.appBuilderApiKey') return 'app-builder-key';
      if (key === 'aiProxy.maxBodyBytes') return 10;
      return fallback;
    });

    await expect(createService().proxyChatCompletion({ ...body }, user)).rejects.toThrow(
      'Request body is too large',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects oversized message content', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'litellm.appBuilderApiKey') return 'app-builder-key';
      if (key === 'aiProxy.maxMessageContentChars') return 5;
      return fallback;
    });

    await expect(
      createService().proxyChatCompletion({
        ...body,
        messages: [{ role: ChatMessageRole.USER, content: 'too-long' }],
      }, user),
    ).rejects.toThrow('Message content is too large');
    expect(post).not.toHaveBeenCalled();
  });
});
