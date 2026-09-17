import { ConfigService } from '@nestjs/config';
import { UsageService } from '../usage';
import { LoggerService } from '../logger';
import { AiProxyUsageService } from './ai-proxy-usage.service';

describe('AiProxyUsageService', () => {
  const usageService = {
    recordUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as UsageService;
  const logger = {
    warn: jest.fn(),
  } as unknown as LoggerService;

  const createService = () => new AiProxyUsageService(usageService, logger);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves known and unknown token payloads', () => {
    const service = createService();

    expect(service.resolveTokens(undefined)).toEqual({ status: 'unknown' });
    expect(service.resolveTokens({})).toEqual({ status: 'unknown' });
    expect(service.resolveTokens({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      status: 'known',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: undefined,
    });
  });

  it('records known tokens without marking them unknown', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'known', promptTokens: 1, completionTokens: 2 },
      streaming: false,
      litellmRequestId: 'chatcmpl-1',
    });

    expect(usageService.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 1,
        outputTokens: 2,
        metadata: expect.objectContaining({
          tokensStatus: 'known',
          litellmRequestId: 'chatcmpl-1',
          streaming: false,
        }),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('marks missing stream tokens as unknown instead of silent zero usage', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'unknown' },
      streaming: true,
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(usageService.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
        metadata: expect.objectContaining({
          tokensStatus: 'unknown',
          streaming: true,
        }),
      }),
    );
  });
});
