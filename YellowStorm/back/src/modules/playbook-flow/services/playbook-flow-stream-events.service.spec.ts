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

  it('hydrates clarification interrupt payloads for active pending executions', async () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'exec-2',
              flowId: 'flow-1',
              status: 'pending_approval',
              executionMode: 'live',
              stepExecutionModes: {},
              reflectionEnabled: false,
              advisorScoringMode: 'llm',
              advisorAutopilotEnabled: false,
              advisorAutopilotTargetScore: 90,
              advisorAutopilotMaxTurns: 4,
              replayPlanningByTask: null,
              threadId: 'thread-1',
              pendingApproval: {
                nodeId: 'task-1',
                iteration: 2,
                prompt: 'Which country did you mean?',
                interruptType: 'clarification',
                interruptId: 'task-1:clarification:2',
                taskTitle: 'GDP Analysis',
                taskDescription: 'Need a target country',
                result: '',
                payloadJson: '[]',
                resumableActions: ['reply', 'skip'],
              },
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
            status: 'pending_approval',
            interruptPayload: expect.objectContaining({
              type: 'clarification',
              taskId: 'task-1',
              taskTitle: 'GDP Analysis',
              message: 'Which country did you mean?',
              interruptId: 'task-1:clarification:2',
              taskDescription: 'Need a target country',
              payloadJson: '[]',
              resumableActions: ['reply', 'skip'],
            }),
          }),
        ],
      }),
    });
  });
});
