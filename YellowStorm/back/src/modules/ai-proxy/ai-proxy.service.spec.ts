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
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        'litellm.appBuilderApiKey': 'app-builder-key',
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  const user = { _id: { toString: () => 'user-123' } } as unknown as UserDocument;
  const streamService = {
    streamChatCompletion: jest.fn(),
  } as unknown as AiProxyStreamService;
  const body: ChatCompletionDto = {
    model: 'gpt-4o',
    messages: [{ role: ChatMessageRole.USER, content: 'Hello' }],
    stream: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    connectionService.getHttpClient.mockReturnValue({ post } as unknown as AxiosInstance);
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: null,
      inactive: false,
      unsupported: false,
    });
    post.mockResolvedValue({ data: { id: 'completion-1' } });
  });

  it('forwards non-streaming requests with the app builder key and user header', async () => {
    const service = new AiProxyService(connectionService, modelsService, configService, streamService);

    await expect(service.proxyChatCompletion(body, user)).resolves.toEqual({
      id: 'completion-1',
    });

    expect(modelsService.validateModelActive).toHaveBeenCalledWith('gpt-4o', 'chat');
    expect(post).toHaveBeenCalledWith(
      '/v1/chat/completions',
      { ...body, stream: false },
      {
        headers: {
          Authorization: 'Bearer app-builder-key',
          'X-Request-User': 'user-123',
        },
        timeout: AI_PROXY_REQUEST_TIMEOUT_MS,
      },
    );
  });

  it('delegates streaming requests to AiProxyStreamService', async () => {
    const service = new AiProxyService(connectionService, modelsService, configService, streamService);
    const request = {} as Request;
    const response = {} as Response;
    (streamService.streamChatCompletion as jest.Mock).mockResolvedValue(undefined);

    const streamingBody = { ...body, stream: true };
    await expect(
      service.proxyChatCompletion(streamingBody, user, request, response),
    ).resolves.toBeUndefined();

    expect(streamService.streamChatCompletion).toHaveBeenCalledWith(
      request,
      response,
      streamingBody,
      user,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects streaming when request or response context is missing', async () => {
    const service = new AiProxyService(connectionService, modelsService, configService, streamService);

    await expect(
      service.proxyChatCompletion({ ...body, stream: true }, user),
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
    const service = new AiProxyService(connectionService, modelsService, configService, streamService);

    await expect(service.proxyChatCompletion(body, user)).rejects.toThrow(
      "Model 'gpt-4o' is not available",
    );

    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed when the app builder key is not configured', async () => {
    (configService.get as jest.Mock).mockImplementation((_key: string, fallback?: unknown) => fallback);
    const service = new AiProxyService(connectionService, modelsService, configService, streamService);

    await expect(service.proxyChatCompletion(body, user)).rejects.toThrow(
      'LiteLLM',
    );
    expect(post).not.toHaveBeenCalled();
  });
});
