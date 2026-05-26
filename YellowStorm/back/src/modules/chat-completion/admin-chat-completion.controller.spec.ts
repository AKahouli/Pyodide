import { Types } from 'mongoose';
import { AdminChatCompletionController } from './admin-chat-completion.controller';
import { ChatCompletionService } from './chat-completion.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { CompletionResult } from './interfaces/chat-completion.interface';

const MOCK_ACTOR = {
  _id: new Types.ObjectId(),
  email: 'admin@test.com',
} as any;

const MOCK_REQUEST = {
  ip: '127.0.0.1',
  headers: { 'user-agent': 'test-agent' },
} as any;

const MOCK_RESULT: CompletionResult = {
  content: 'Hello!',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  model: 'azure/gpt-4o',
  latencyMs: 250,
};

describe('AdminChatCompletionController', () => {
  let controller: AdminChatCompletionController;
  let chatCompletionService: jest.Mocked<Pick<ChatCompletionService, 'complete'>>;
  let auditLogService: jest.Mocked<Pick<AuditLogService, 'logSuccess'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    chatCompletionService = {
      complete: jest.fn().mockResolvedValue(MOCK_RESULT),
    };

    auditLogService = {
      logSuccess: jest.fn(),
    };

    controller = new AdminChatCompletionController(
      chatCompletionService as unknown as ChatCompletionService,
      auditLogService as unknown as AuditLogService,
    );
  });

  describe('chat', () => {
    const dto = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      modelId: 'gpt-4o',
      temperature: 0.5,
      systemPrompt: 'Be helpful.',
    };

    it('should call chatCompletionService.complete with correct params', async () => {
      await controller.chat(dto, MOCK_ACTOR, MOCK_REQUEST);

      expect(chatCompletionService.complete).toHaveBeenCalledWith({
        messages: dto.messages,
        modelId: 'gpt-4o',
        temperature: 0.5,
        systemPrompt: 'Be helpful.',
      });
    });

    it('should return the completion result', async () => {
      const result = await controller.chat(dto, MOCK_ACTOR, MOCK_REQUEST);

      expect(result).toEqual(MOCK_RESULT);
    });

    it('should log an audit event on success', async () => {
      await controller.chat(dto, MOCK_ACTOR, MOCK_REQUEST);

      expect(auditLogService.logSuccess).toHaveBeenCalledWith({
        actorId: MOCK_ACTOR._id.toString(),
        actorEmail: 'admin@test.com',
        action: 'chat_completion.chat',
        targetType: 'ChatCompletion',
        metadata: {
          model: 'azure/gpt-4o',
          totalTokens: 15,
          latencyMs: 250,
          messageCount: 1,
        },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should pass optional fields as undefined when not provided', async () => {
      const minimalDto = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        modelId: 'gpt-4o',
      };

      await controller.chat(minimalDto, MOCK_ACTOR, MOCK_REQUEST);

      expect(chatCompletionService.complete).toHaveBeenCalledWith({
        messages: minimalDto.messages,
        modelId: 'gpt-4o',
        temperature: undefined,
        systemPrompt: undefined,
      });
    });

    it('should propagate service errors', async () => {
      const error = new Error('Service failed');
      chatCompletionService.complete.mockRejectedValue(error);

      await expect(controller.chat(dto, MOCK_ACTOR, MOCK_REQUEST)).rejects.toThrow(
        'Service failed',
      );
      expect(auditLogService.logSuccess).not.toHaveBeenCalled();
    });
  });
});
