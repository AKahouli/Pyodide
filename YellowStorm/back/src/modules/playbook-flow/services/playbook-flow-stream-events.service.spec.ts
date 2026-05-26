import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';

describe('PlaybookFlowStreamEventsService', () => {
  it('includes step execution modes in execution start events', async () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      countDocuments: jest.fn().mockResolvedValue(7),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any);

    await service.emitExecutionStart('exec-1', 'flow-1', 'user-1', {
      executionMode: 'inherit',
      stepExecutionModes: { 'step-1': 'replay_flex' },
    });

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_execution_start',
      data: expect.objectContaining({
        executionId: 'exec-1',
        playbookId: 'flow-1',
        executionNumber: 7,
        executionMode: 'inherit',
        stepExecutionModes: { 'step-1': 'replay_flex' },
      }),
    });
  });

  it('hydrates active replay executions with persisted execution and step modes', async () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'exec-1',
              flowId: 'flow-1',
              status: 'running',
              executionMode: 'inherit',
              stepExecutionModes: { 'step-1': 'replay_flex' },
              reflectionEnabled: false,
              advisorScoringMode: 'llm',
              advisorAutopilotEnabled: false,
              advisorAutopilotTargetScore: 90,
              advisorAutopilotMaxTurns: 4,
              replayPlanningByTask: null,
              threadId: null,
              pendingApproval: null,
              singleStepTaskId: null,
              startedAt: new Date('2025-01-01T00:00:00.000Z'),
              createdAt: new Date('2025-01-01T00:00:00.000Z'),
              updatedAt: new Date('2025-01-01T00:00:05.000Z'),
            },
          ]),
        }),
      }),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any);

    await service.emitConnected('user-1');

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_connected',
      data: expect.objectContaining({
        activeExecutions: [
          expect.objectContaining({
            id: 'exec-1',
            executionMode: 'inherit',
            stepExecutionModes: { 'step-1': 'replay_flex' },
          }),
        ],
      }),
    });
  });
});
