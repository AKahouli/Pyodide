import { SecondBrainService } from './second-brain.service';

describe('SecondBrainService', () => {
  const agentService = {
    findActiveDefaultAgentIdBySlug: jest.fn().mockResolvedValue('agent-1'),
  };
  const taskExecutionService = {
    runSingleAgentTask: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns the persisted response for a completed idempotent replay without executing again', async () => {
    const responsePayload = {
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      answer: 'Open the generated Playbook.',
      toolResults: [{ name: 'start_playbook_generation', status: 'completed' }],
      pendingAction: null,
    };
    const requestService = {
      claimTurn: jest.fn().mockResolvedValue({
        replay: true,
        request: {
          requestId: 'request-1',
          conversationId: 'conversation-1',
          correlationId: 'correlation-1',
          responsePayload,
        },
      }),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const service = new SecondBrainService(
      agentService as never,
      taskExecutionService as never,
      requestService as never,
    );

    await expect(service.runTurn('user-1', {
      requestId: 'request-1',
      message: 'Build lead scoring',
      pageContext: { route: '/playbooks' },
    })).resolves.toEqual({ ...responsePayload, requestId: 'request-1' });
    expect(taskExecutionService.runSingleAgentTask).not.toHaveBeenCalled();
    expect(requestService.complete).not.toHaveBeenCalled();
  });

  it('persists the complete response and fingerprints trusted page context on first execution', async () => {
    const requestService = {
      claimTurn: jest.fn().mockResolvedValue({
        replay: false,
        request: {
          requestId: 'request-1',
          conversationId: 'conversation-1',
          correlationId: 'correlation-1',
        },
      }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn(),
    };
    taskExecutionService.runSingleAgentTask.mockResolvedValueOnce({
      text: 'Found it.',
      toolResults: [],
    });
    const service = new SecondBrainService(
      agentService as never,
      taskExecutionService as never,
      requestService as never,
    );

    const result = await service.runTurn('user-1', {
      requestId: 'request-1',
      message: 'Find my Playbook',
      pageContext: { route: '/playbooks' },
    });

    expect(requestService.claimTurn).toHaveBeenCalledWith(expect.objectContaining({
      context: { route: '/playbooks' },
    }));
    expect(requestService.complete).toHaveBeenCalledWith(
      'request-1',
      'Found it.',
      undefined,
      expect.objectContaining({ answer: 'Found it.', toolResults: [] }),
    );
    expect(result).toEqual(expect.objectContaining({ requestId: 'request-1', answer: 'Found it.' }));
  });
});
