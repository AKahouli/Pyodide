import { UsageService } from '../usage';
import { LoggerService } from '../logger';
import { ModelsService } from '../models/models.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';

describe('AiProxyUsageService', () => {
  const usageService = {
    recordUsage: jest.fn().mockResolvedValue(undefined),
  } as unknown as UsageService;
  const modelsService = {
    findPricing: jest.fn(),
  } as unknown as jest.Mocked<ModelsService>;
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  const createService = () => new AiProxyUsageService(usageService, modelsService, logger);

  beforeEach(() => {
    jest.clearAllMocks();
    modelsService.findPricing.mockResolvedValue({
      provider: 'openai',
      inputCostPerToken: 0.000001,
      outputCostPerToken: 0.000002,
      cachedInputCostPerToken: null,
      version: 'litellm:test',
    });
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

  it('estimates cost from ModelsService pricing', () => {
    const service = createService();
    expect(service.estimateCost(
      { status: 'known', promptTokens: 10, completionTokens: 5 },
      { inputCostPerToken: 0.000001, outputCostPerToken: 0.000002 },
    )).toBeCloseTo(0.00002);
    expect(service.estimateCost({ status: 'unknown' }, {
      inputCostPerToken: 0.000001,
      outputCostPerToken: 0.000002,
    })).toBeNull();
  });

  it('records known tokens with pricing metadata from ModelsService', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'known', promptTokens: 1, completionTokens: 2 },
      streaming: false,
      litellmRequestId: 'chatcmpl-1',
    });

    expect(modelsService.findPricing).toHaveBeenCalledWith('gpt-4o');
    expect(usageService.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 1,
        outputTokens: 2,
        metadata: expect.objectContaining({
          tokensStatus: 'known',
          litellmRequestId: 'chatcmpl-1',
          streaming: false,
          estimatedCost: expect.any(Number),
          pricing: expect.objectContaining({
            provider: 'openai',
            inputCostPerToken: 0.000001,
            outputCostPerToken: 0.000002,
          }),
        }),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('attributes deployed app_end_user usage via appDataId → workspace → session', async () => {
    const appBuilderAiUsage = {
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      findOne: jest.fn().mockReturnValue({
        select: () => ({
          lean: () => ({
            exec: async () => ({
              _id: { toString: () => 'session-42' },
              title: 'Draft',
              deployedAppTitle: 'Deployed App',
            }),
          }),
        }),
      }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const appDataCatalog = {
      findByAppDataId: jest.fn().mockResolvedValue({
        appDataId: 'appdata_1',
        workspaceId: 'ws-1',
      }),
    };
    const service = new AiProxyUsageService(
      usageService,
      modelsService,
      logger,
      appBuilderAiUsage as never,
      sessions as never,
      appDataCatalog as never,
    );

    const request = {
      aiProxyAuth: {
        mode: 'app_end_user' as const,
        appDataId: 'appdata_1',
        endUserId: 'eu-1',
      },
      ip: '127.0.0.1',
      get: () => undefined,
    };

    await service.recordChatCompletionUsage({
      userId: 'owner-1',
      model: 'gpt-4o',
      request: request as never,
      startedAt: Date.now() - 5,
      success: true,
      tokens: { status: 'known', promptTokens: 10, completionTokens: 20 },
      streaming: false,
      pricing: null,
    });

    expect(appDataCatalog.findByAppDataId).toHaveBeenCalledWith('appdata_1');
    expect(sessions.findOne).toHaveBeenCalledWith({
      aiSessionId: 'ws-1',
      deletedAt: null,
    });
    expect(appBuilderAiUsage.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        inputTokens: 10,
        outputTokens: 20,
        metadata: expect.objectContaining({
          authMode: 'app_end_user',
          appDataId: 'appdata_1',
          endUserId: 'eu-1',
          workspaceId: 'ws-1',
          sessionId: 'session-42',
          appTitle: 'Deployed App',
        }),
      }),
    );
    expect(sessions.updateOne).toHaveBeenCalledWith(
      { _id: 'session-42', deletedAt: null },
      { $set: { hasAiFeatures: true } },
    );
    expect(usageService.recordUsage).not.toHaveBeenCalled();
  });

  it('attributes deployed usage via App Data remote client when catalog is absent', async () => {
    const appBuilderAiUsage = {
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = {
      findOne: jest.fn().mockReturnValue({
        select: () => ({
          lean: () => ({
            exec: async () => ({
              _id: { toString: () => 'session-99' },
              title: 'Remote App',
              deployedAppTitle: 'Remote Deployed',
            }),
          }),
        }),
      }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const appDataClient = {
      isEnabled: () => true,
      getStatus: jest.fn().mockResolvedValue({
        app: { id: 'appdata_remote', workspaceId: 'ws-remote' },
        environments: [],
      }),
    };
    const service = new AiProxyUsageService(
      usageService,
      modelsService,
      logger,
      appBuilderAiUsage as never,
      sessions as never,
      undefined,
      appDataClient as never,
    );

    await service.recordChatCompletionUsage({
      userId: 'owner-2',
      model: 'gpt-4o',
      request: {
        aiProxyAuth: {
          mode: 'app_end_user',
          appDataId: 'appdata_remote',
          endUserId: 'eu-2',
        },
        ip: '127.0.0.1',
        get: () => undefined,
      } as never,
      startedAt: Date.now() - 5,
      success: true,
      tokens: { status: 'known', promptTokens: 3, completionTokens: 4 },
      streaming: false,
      pricing: null,
    });

    expect(appDataClient.getStatus).toHaveBeenCalledWith('appdata_remote');
    expect(appBuilderAiUsage.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workspaceId: 'ws-remote',
          sessionId: 'session-99',
          appTitle: 'Remote Deployed',
        }),
      }),
    );
  });

  it('marks missing stream tokens as unknown instead of silent zero usage', async () => {
    await createService().recordChatCompletionUsage({
      userId: 'user-1',
      model: 'gpt-4o',
      startedAt: Date.now() - 10,
      success: true,
      tokens: { status: 'unknown' },
      streaming: true,
      pricing: null,
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(modelsService.findPricing).not.toHaveBeenCalled();
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
