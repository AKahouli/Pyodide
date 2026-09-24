import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';

const configService = {
  get: jest.fn(),
};

describe('PlaybookFlowStreamEventsService', () => {
  it('includes step execution modes in execution start events', async () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      countDocuments: jest.fn().mockResolvedValue(7),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);

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
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);

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
                blockerRuleId: 'rule-1',
                blockerKind: 'missing_required_input',
                reasonCode: 'missing_required_input',
                riskLevel: 'medium',
                confidence: 1,
                downstreamNodeIds: ['task-2'],
                feedbackScopeDefault: 'downstream_run',
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
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);

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
              blockerRuleId: 'rule-1',
              blockerKind: 'missing_required_input',
              reasonCode: 'missing_required_input',
              riskLevel: 'medium',
              confidence: 1,
              downstreamNodeIds: ['task-2'],
              feedbackScopeDefault: 'downstream_run',
            }),
          }),
        ],
      }),
    });
  });

  it('emits dedicated HITL interrupt events alongside legacy interrupt events', () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      countDocuments: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);
    service.cacheOwner('exec-1', 'user-1');

    service.emitInterrupt('exec-1', 'task-1', 'Need approval', 3, 'thread-1', {
      interruptType: 'approval_request',
      interruptId: 'interrupt-1',
      blockerRuleId: 'rule-1',
      blockerKind: 'external_send',
      reasonCode: 'external_send',
      riskLevel: 'critical',
      downstreamNodeIds: ['task-2'],
      feedbackScopeDefault: 'downstream_run',
    });

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
      type: 'playbook_interrupt',
    }));
    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_hitl_interrupt_created',
      data: expect.objectContaining({
        executionId: 'exec-1',
        taskId: 'task-1',
        interruptId: 'interrupt-1',
        blockerRuleId: 'rule-1',
        blockerKind: 'external_send',
        reasonCode: 'external_send',
        riskLevel: 'critical',
        downstreamNodeIds: ['task-2'],
        feedbackScopeDefault: 'downstream_run',
      }),
    });
  });

  it('emits HITL resolved events for resumed interrupts', () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      countDocuments: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);
    service.cacheOwner('exec-1', 'user-1');

    service.emitHitlInterruptResolved('exec-1', 'interrupt-1', {
      action: 'reply',
      taskId: 'task-1',
      scope: 'downstream_run',
      remember: true,
    });

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_hitl_interrupt_resolved',
      data: {
        executionId: 'exec-1',
        interruptId: 'interrupt-1',
        action: 'reply',
        taskId: 'task-1',
        scope: 'downstream_run',
        remember: true,
      },
    });
  });

  it('emits remaining HITL lifecycle events from cached execution ownership', () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionModel = {
      countDocuments: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionModel as any, configService as any);
    service.cacheOwner('exec-1', 'user-1');

    service.emitHitlBlockerDisabled('exec-1', 'rule-1', { taskId: 'task-1' });
    service.emitHitlPolicyUpdated('exec-1', { flowId: 'flow-1' });
    service.emitReplayHitlSummaryUpdated('exec-1', { runtimeHitlCount: 2 });

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_hitl_blocker_disabled',
      data: { executionId: 'exec-1', blockerId: 'rule-1', taskId: 'task-1' },
    });
    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_hitl_policy_updated',
      data: { executionId: 'exec-1', flowId: 'flow-1' },
    });
    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_replay_hitl_summary_updated',
      data: { executionId: 'exec-1', runtimeHitlCount: 2 },
    });
  });
});
