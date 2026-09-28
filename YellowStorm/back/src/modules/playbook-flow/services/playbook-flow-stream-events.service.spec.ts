import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';

const configService = {
  get: jest.fn(),
};

describe('PlaybookFlowStreamEventsService', () => {
  it('notifies a recipient when a playbook is shared with them', () => {
    const streamGateway = { sendToUser: jest.fn() };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, {} as any, configService as any);

    service.emitPlaybookShared('user-1', 'flow-1');

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_shared',
      data: { playbookId: 'flow-1' },
    });
  });

  it('includes step execution modes in execution start events', async () => {
    const streamGateway = {
      sendToUser: jest.fn(),
    };
    const executionRepository = {
      countByFlow: jest.fn().mockResolvedValue(7),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);

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
    const executionRepository = {
      listActive: jest.fn().mockResolvedValue([
        {
          id: 'exec-1',
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
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);

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
    const executionRepository = {
      listActive: jest.fn().mockResolvedValue([
        {
          id: 'exec-2',
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
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);

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
    const executionRepository = {
      countByFlow: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);
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
    const executionRepository = {
      countByFlow: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);
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
    const executionRepository = {
      countByFlow: jest.fn(),
    };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);
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

  it('hydrates each active execution, oldest first, with its own task results and dynamic reasoning attempts', async () => {
    const streamGateway = { sendToUser: jest.fn() };
    const activeRun = (id: string, createdAt: string) => ({
      id, flowId: 'flow-1', status: 'running', executionMode: 'live', stepExecutionModes: {}, reflectionEnabled: false, advisorScoringMode: 'llm',
      advisorAutopilotEnabled: false, advisorAutopilotTargetScore: null, advisorAutopilotMaxTurns: null, replayPlanningByTask: {}, threadId: null,
      pendingApproval: null, singleStepTaskId: null, startedAt: null, createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
    });
    const executionRepository = {
      // Newest first, as the repository lists them.
      listActive: jest.fn().mockResolvedValue([activeRun('exec-b', '2025-01-02T00:00:00.000Z'), activeRun('exec-a', '2025-01-01T00:00:00.000Z')]),
    };
    const taskResultRepository = {
      listForExecutions: jest.fn().mockResolvedValue([
        { executionId: 'exec-a', taskId: 'task-1', iteration: 0, status: 'completed', output: 'done', error: null, parentTaskId: null, runtimeSubgraphId: null, generatedLocalNodeId: null, generatedNodeTitle: null },
        { executionId: 'exec-b', taskId: 'task-2', iteration: 1, status: 'running', output: null, error: null, parentTaskId: 'parent-1', runtimeSubgraphId: 'sub-1', generatedLocalNodeId: 'local-1', generatedNodeTitle: 'Generated' },
      ]),
    };
    const attemptRepository = {
      listForExecutions: jest.fn().mockResolvedValue([
        { id: 'attempt-1', executionId: 'exec-b', flowId: 'flow-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0, status: 'planning', subgraphId: null, revisions: [], decision: null },
      ]),
    };
    const service = new PlaybookFlowStreamEventsService(
      streamGateway as any, executionRepository as any, configService as any, taskResultRepository as any, attemptRepository as any,
    );

    await service.emitConnected('user-1');

    expect(executionRepository.listActive).toHaveBeenCalledWith('user-1');
    expect(taskResultRepository.listForExecutions).toHaveBeenCalledWith(['exec-a', 'exec-b'], { light: true, with: ['output'] });
    expect(attemptRepository.listForExecutions).toHaveBeenCalledWith(['exec-a', 'exec-b']);
    const [, event] = streamGateway.sendToUser.mock.calls[0];
    const [first, second] = event.data.activeExecutions;
    expect(first).toMatchObject({ id: 'exec-a', startedAt: new Date('2025-01-01T00:00:00.000Z'), advisorAutopilotTargetScore: 90, advisorAutopilotMaxTurns: 4, dynamicReasoningAttempts: [] });
    expect(first.taskResults).toStrictEqual([{
      taskId: 'task-1', iteration: 0, status: 'completed', output: 'done', error: null,
      parentTaskId: undefined, runtimeSubgraphId: undefined, generatedLocalNodeId: undefined, generatedNodeTitle: undefined,
    }]);
    expect(second.id).toBe('exec-b');
    expect(second.taskResults).toEqual([expect.objectContaining({ taskId: 'task-2', output: null, parentTaskId: 'parent-1', runtimeSubgraphId: 'sub-1', generatedLocalNodeId: 'local-1', generatedNodeTitle: 'Generated' })]);
    // A field the attempt never had is absent, as on the lean Mongo document.
    expect(second.dynamicReasoningAttempts).toStrictEqual([
      { id: 'attempt-1', executionId: 'exec-b', flowId: 'flow-1', parentTaskId: 'parent-1', parentIteration: 0, attempt: 0, status: 'planning', revisions: [] },
    ]);
  });

  it('reports the stored error when an execution ends and forgets its owner', async () => {
    const streamGateway = { sendToUser: jest.fn() };
    const executionRepository = { findById: jest.fn().mockResolvedValue({ id: 'exec-1', error: 'Task failed' }) };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);
    service.cacheOwner('exec-1', 'user-1');

    await service.emitExecutionComplete('exec-1', 'failed');
    service.emitStepStart('exec-1', 'task-1');

    expect(executionRepository.findById).toHaveBeenCalledWith('exec-1');
    expect(streamGateway.sendToUser).toHaveBeenCalledTimes(1);
    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_execution_error',
      data: { executionId: 'exec-1', status: 'failed', error: 'Task failed', durationMs: undefined },
    });
  });

  it('leaves the error out of a completion event when the execution has none', async () => {
    const streamGateway = { sendToUser: jest.fn() };
    const executionRepository = { findById: jest.fn().mockResolvedValue({ id: 'exec-1', error: null }) };
    const service = new PlaybookFlowStreamEventsService(streamGateway as any, executionRepository as any, configService as any);
    service.cacheOwner('exec-1', 'user-1');

    await service.emitExecutionComplete('exec-1', 'completed', undefined, 1200);

    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'playbook_execution_complete',
      data: { executionId: 'exec-1', status: 'completed', error: undefined, durationMs: 1200 },
    });
  });
});
