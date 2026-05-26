import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosResponse } from 'axios';
import { ChatCompletionService } from './chat-completion.service';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { ModelsService } from '../models/models.service';
import { LoggerService } from '../logger';
import { ErrorCode } from '../exceptions/constants/error-codes';

const mockLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockConnectionService = {
  getHttpClient: jest.fn(),
};

const mockModelsService = {
  findById: jest.fn(),
};

const MOCK_MODEL = {
  id: 'gpt-4o',
  name: 'GPT 4o',
  chef: 'OpenAI',
  chefSlug: 'openai',
  litellmModel: 'azure/gpt-4o',
  providers: ['openai'],
  isActive: true,
  isDefault: true,
};

const MOCK_LITELLM_RESPONSE = {
  data: {
    id: 'chatcmpl-123',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello! How can I help you?' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
    model: 'azure/gpt-4o',
  },
};

describe('ChatCompletionService', () => {
  let service: ChatCompletionService;
  let mockHttpClient: { post: jest.Mock };

  beforeEach(async () => {
    mockHttpClient = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatCompletionService,
        { provide: LiteLLMConnectionService, useValue: mockConnectionService },
        { provide: ModelsService, useValue: mockModelsService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ChatCompletionService>(ChatCompletionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('complete', () => {
    it('should return a CompletionResult on success', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      const result = await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
      });

      expect(result.content).toBe('Hello! How can I help you?');
      expect(result.usage.promptTokens).toBe(10);
      expect(result.usage.completionTokens).toBe(8);
      expect(result.usage.totalTokens).toBe(18);
      expect(result.model).toBe('azure/gpt-4o');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should call LiteLLM with correct payload', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
        temperature: 0.5,
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.5,
          stream: false,
        },
        { timeout: 360_000 },
      );
    });

    it('should use default temperature when not provided', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/v1/chat/completions',
        expect.objectContaining({
          temperature: 0.7,
        }),
        expect.anything(),
      );
    });

    it('should prepend system prompt when provided', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
        systemPrompt: 'You are helpful.',
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/v1/chat/completions',
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
          ],
        }),
        expect.anything(),
      );
    });

    it('should not prepend system prompt when empty', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/v1/chat/completions',
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
        expect.anything(),
      );
    });

    it('should throw CHAT_COMPLETION_LITELLM_UNAVAILABLE when httpClient is null', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(null);

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'gpt-4o',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      });
    });

    it('should throw CHAT_COMPLETION_MODEL_NOT_FOUND when model does not exist', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(null);

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'nonexistent',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CHAT_COMPLETION_MODEL_NOT_FOUND,
      });
    });

    it('should throw CHAT_COMPLETION_MODEL_NOT_FOUND when model has no litellmModel', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue({ ...MOCK_MODEL, litellmModel: '' });

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'gpt-4o',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CHAT_COMPLETION_MODEL_NOT_FOUND,
      });
    });

    it('should throw CHAT_COMPLETION_LITELLM_UNAVAILABLE on connection refused', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);

      const axiosError = new AxiosError('Connection refused');
      axiosError.code = 'ECONNREFUSED';
      mockHttpClient.post.mockRejectedValue(axiosError);

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'gpt-4o',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      });
    });

    it('should throw CHAT_COMPLETION_LITELLM_UNAVAILABLE on timeout', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);

      const axiosError = new AxiosError('Timeout');
      axiosError.code = 'ETIMEDOUT';
      mockHttpClient.post.mockRejectedValue(axiosError);

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'gpt-4o',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CHAT_COMPLETION_LITELLM_UNAVAILABLE,
      });
    });

    it('should throw InternalServerException on HTTP error response', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);

      const axiosError = new AxiosError('Bad Request');
      axiosError.response = { status: 400, data: { error: { message: 'Invalid model' } } } as AxiosResponse;
      mockHttpClient.post.mockRejectedValue(axiosError);

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          modelId: 'gpt-4o',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
      });
    });

    it('should handle missing usage/choices in response gracefully', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue({
        data: { id: 'x', choices: [], usage: undefined, model: undefined },
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        modelId: 'gpt-4o',
      });

      expect(result.content).toBe('');
      expect(result.usage.promptTokens).toBe(0);
      expect(result.usage.completionTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
      expect(result.model).toBe('azure/gpt-4o');
    });
  });

  describe('completeText', () => {
    it('should wrap prompt as user message and return content string', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      const result = await service.completeText('Hello', {
        modelId: 'gpt-4o',
        temperature: 0.3,
        systemPrompt: 'Be brief.',
      });

      expect(result).toBe('Hello! How can I help you?');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/v1/chat/completions',
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'Be brief.' },
            { role: 'user', content: 'Hello' },
          ],
          temperature: 0.3,
        }),
        expect.anything(),
      );
    });

    it('should pass through modelId to complete()', async () => {
      mockConnectionService.getHttpClient.mockReturnValue(mockHttpClient);
      mockModelsService.findById.mockResolvedValue(MOCK_MODEL);
      mockHttpClient.post.mockResolvedValue(MOCK_LITELLM_RESPONSE);

      await service.completeText('Hello', { modelId: 'gpt-4o' });

      expect(mockModelsService.findById).toHaveBeenCalledWith('gpt-4o');
    });
  });
});
