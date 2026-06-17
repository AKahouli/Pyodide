import { Test, TestingModule } from '@nestjs/testing';
import { StreamService } from '@modules/conversation/services/stream.service';
import { LoggerService } from '@modules/logger';
import { WhatsAppStreamService } from './whatsapp-stream.service';

describe('WhatsAppStreamService', () => {
  let service: WhatsAppStreamService;

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockStreamService = {
    runSingleAgentStream: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStreamService.runSingleAgentStream.mockResolvedValue({
      chunkCount: 3,
      componentCount: 2,
      durationMs: 1500,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppStreamService,
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: StreamService, useValue: mockStreamService },
      ],
    }).compile();

    service = module.get(WhatsAppStreamService);
  });

  it('delegates to runSingleAgentStream and logs completion', async () => {
    await service.runStream({
      userId: 'user-1',
      username: 'user@example.com',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      linkedAgentId: 'agent-1',
      query: 'Hello',
      requestId: 'req-1',
    });

    expect(mockStreamService.runSingleAgentStream).toHaveBeenCalledWith({
      userId: 'user-1',
      username: 'user@example.com',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      agentId: 'agent-1',
      query: 'Hello',
      requestId: 'req-1',
    });
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      'WhatsApp RunSingleAgent gRPC starting',
      expect.objectContaining({ conversationId: 'conv-1', requestId: 'req-1' }),
    );
    expect(mockLoggerService.log).toHaveBeenCalledWith(
      'WhatsApp RunSingleAgent gRPC completed',
      expect.objectContaining({ chunkCount: 3, componentCount: 2, durationMs: 1500 }),
    );
  });
});
