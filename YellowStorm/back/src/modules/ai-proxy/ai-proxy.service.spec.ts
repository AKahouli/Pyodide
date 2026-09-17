import { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';
import { AiProxyService } from './ai-proxy.service';
import { ChatCompletionDto, ChatMessageRole } from './dto/chat-completion.dto';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import { UserDocument } from '../user/schemas/user.schema';

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
        'litellm.timeoutMs': 300000,
      };
      return values[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  const user = { _id: { toString: () => 'user-123' } } as unknown as UserDocument;
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
    const service = new AiProxyService(connectionService, modelsService, configService);

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
        timeout: 300000,
      },
    );
  });

  it('rejects streaming requests during the non-streaming phase', async () => {
    const service = new AiProxyService(connectionService, modelsService, configService);

    await expect(
      service.proxyChatCompletion({ ...body, stream: true }, user),
    ).rejects.toThrow('Streaming is not available');

    expect(modelsService.validateModelActive).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects inactive or unsupported models before calling LiteLLM', async () => {
    modelsService.validateModelActive.mockResolvedValue({
      valid: false,
      model: null,
      inactive: false,
      unsupported: true,
    });
    const service = new AiProxyService(connectionService, modelsService, configService);

    await expect(service.proxyChatCompletion(body, user)).rejects.toThrow(
      "Model 'gpt-4o' is not available",
    );

    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed when the app builder key is not configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => (
      key === 'litellm.timeoutMs' ? 300000 : fallback
    ));
    const service = new AiProxyService(connectionService, modelsService, configService);

    await expect(service.proxyChatCompletion(body, user)).rejects.toThrow(
      'LiteLLM',
    );
    expect(post).not.toHaveBeenCalled();
  });
});
