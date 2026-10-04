import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { PlaybookExecutionHitlResumeService, type PlaybookExecutionHitlResumeHost } from './playbook-execution-hitl-resume.service';

const EXECUTION_ID = '64b000000000000000000001';
const FLOW_ID = '64b000000000000000000002';
const OWNER_ID = '64b000000000000000000003';

function pausedExecution(over: Record<string, unknown> = {}) {
  return {
    id: EXECUTION_ID,
    flowId: FLOW_ID,
    ownerId: OWNER_ID,
    status: 'pending_approval',
    queuePosition: 0,
    inputContext: { topic: 'q3' },
    hitlEvents: [],
    startedAt: null,
    error: null,
    snapshot: { nodes: [{ id: 'review', kind: 'step' }] },
    pendingApproval: {
      nodeId: 'review',
      iteration: 1,
      prompt: 'Check this',
      interruptType: 'clarification',
      interruptId: 'int-1',
      taskTitle: 'Review draft',
      feedbackScopeDefault: 'step_only',
      riskLevel: 'medium',
    },
    ...over,
  };
}

function createService(execution: Record<string, unknown> | null = pausedExecution()) {
  const executionRepository = {
    findById: jest.fn().mockResolvedValue(execution),
    transition: jest.fn().mockResolvedValue(true),
    answerHitlEvent: jest.fn().mockResolvedValue(true),
  };
  const streamEvents = {
    emitHitlInterruptResolved: jest.fn(),
    emitHitlMemorySaved: jest.fn(),
  };
  const hitlMemoryRepository = { create: jest.fn().mockResolvedValue({ id: 'mem-1' }) };
  const accessService = { assertExecutionAccess: jest.fn().mockResolvedValue(undefined) };
  const host: jest.Mocked<PlaybookExecutionHitlResumeHost> = {
    isRuntimeAvailable: jest.fn().mockReturnValue(true),
    resumeApprovalRuntime: jest.fn((_request, callback) => { callback(null, { resumed: true }); }),
    resumeFromStepRuntime: jest.fn((_request, callback) => { callback(null, { resumed: true }); }),
    scheduleDurableResume: jest.fn(),
  };
  const service = new PlaybookExecutionHitlResumeService(
    executionRepository as never,
    streamEvents as never,
    hitlMemoryRepository as never,
    accessService as never,
  );
  service.bindExecutionHost(host);
  return { service, executionRepository, streamEvents, hitlMemoryRepository, accessService, host };
}

const CLAIM = { nodeId: 'review', iteration: 1, interruptId: 'int-1' };

describe('PlaybookExecutionHitlResumeService', () => {
  describe('resumeApproval', () => {
    it('claims the pending approval, resumes the runtime and answers the HITL event under the same guard', async () => {
      const { service, executionRepository, host, streamEvents } = createService();

      const response = await service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved', payload: { message: 'ok' } });

      expect(executionRepository.findById).toHaveBeenCalledWith(EXECUTION_ID, { withSnapshot: true });
      expect(executionRepository.transition).toHaveBeenCalledTimes(1);
      expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, {
        from: ['pending_approval'], pendingApproval: CLAIM, patch: { status: 'running' },
      });
      expect(host.resumeApprovalRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ execution_id: EXECUTION_ID, decision: 'approved' }),
        expect.any(Function),
      );
      expect(executionRepository.answerHitlEvent).toHaveBeenCalledWith(EXECUTION_ID, {
        from: ['running'],
        pendingApproval: CLAIM,
        interruptId: 'int-1',
        response: { action: 'approved', message: 'ok' },
        patch: { status: 'running', pendingApproval: null },
      });
      expect(streamEvents.emitHitlInterruptResolved).toHaveBeenCalledWith(EXECUTION_ID, 'int-1', expect.objectContaining({ action: 'approved', taskId: 'review' }));
      // The run as read (snapshot included, as the +snapshot read returned it), with the resume applied.
      expect(response).toMatchObject({ id: EXECUTION_ID, status: 'running', pendingApproval: null, snapshot: { nodes: [{ id: 'review', kind: 'step' }] } });
      expect(response).not.toHaveProperty('startedAt');
    });

    it('claims a legacy pause without an interrupt id on node and iteration only', async () => {
      const execution = pausedExecution();
      (execution.pendingApproval as Record<string, unknown>).interruptId = undefined;
      const { service, executionRepository } = createService(execution);

      await service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'rejected' });

      expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, expect.objectContaining({ pendingApproval: { nodeId: 'review', iteration: 1 } }));
      expect(executionRepository.answerHitlEvent).toHaveBeenCalledWith(EXECUTION_ID, expect.objectContaining({ interruptId: '' }));
    });

    it('answers a lost claim race with the current state of the run and never calls the runtime', async () => {
      const { service, executionRepository, host, streamEvents } = createService();
      executionRepository.transition.mockResolvedValueOnce(false);
      executionRepository.findById
        .mockResolvedValueOnce(pausedExecution())
        .mockResolvedValueOnce(pausedExecution({ status: 'running', pendingApproval: null, snapshot: undefined }));

      const response = await service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved' });

      expect(host.resumeApprovalRuntime).not.toHaveBeenCalled();
      expect(executionRepository.answerHitlEvent).not.toHaveBeenCalled();
      expect(streamEvents.emitHitlInterruptResolved).not.toHaveBeenCalled();
      expect(executionRepository.findById).toHaveBeenLastCalledWith(EXECUTION_ID);
      expect(response).toMatchObject({ id: EXECUTION_ID, status: 'running', pendingApproval: null });
      expect(response).not.toHaveProperty('snapshot');
    });

    it('reports a run deleted during a lost race as not found', async () => {
      const { service, executionRepository } = createService();
      executionRepository.transition.mockResolvedValueOnce(false);
      executionRepository.findById.mockResolvedValueOnce(pausedExecution()).mockResolvedValueOnce(null);

      await expect(service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('releases the claim when the runtime call fails', async () => {
      const { service, executionRepository, host } = createService();
      host.resumeApprovalRuntime.mockImplementation((_request, callback) => { callback(new Error('grpc down')); });

      await expect(service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved' })).rejects.toThrow('grpc down');

      expect(executionRepository.transition).toHaveBeenLastCalledWith(EXECUTION_ID, {
        from: ['running'], pendingApproval: CLAIM, patch: { status: 'pending_approval' },
      });
      expect(executionRepository.answerHitlEvent).not.toHaveBeenCalled();
    });

    it('answers with the current state when the run moved on between the resume and the answer', async () => {
      const { service, executionRepository, streamEvents, hitlMemoryRepository } = createService();
      executionRepository.answerHitlEvent.mockResolvedValueOnce(false);
      executionRepository.findById
        .mockResolvedValueOnce(pausedExecution())
        .mockResolvedValueOnce(pausedExecution({ status: 'cancelled', pendingApproval: null }));

      const response = await service.resumeApproval(EXECUTION_ID, OWNER_ID, {
        decision: 'approved', payload: { remember: true, scope: 'future_node_runs', feedback: 'Always cite' },
      });

      expect(response).toMatchObject({ status: 'cancelled' });
      expect(hitlMemoryRepository.create).not.toHaveBeenCalled();
      expect(streamEvents.emitHitlInterruptResolved).not.toHaveBeenCalled();
    });

    it('restarts a run the runtime forgot from its snapshot, as queued with the answer in its input', async () => {
      const { service, executionRepository, host } = createService();
      host.resumeApprovalRuntime.mockImplementation((_request, callback) => { callback(null, { resumed: false }); });

      const response = await service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved', payload: { note: 'n' } });

      expect(executionRepository.answerHitlEvent).toHaveBeenCalledWith(EXECUTION_ID, {
        from: ['running', 'pending_approval'],
        interruptId: 'int-1',
        response: { action: 'approved', note: 'n' },
        patch: {
          status: 'queued',
          queuePosition: 0,
          pendingApproval: null,
          inputContext: { topic: 'q3', __playbook_resume: { decision: 'approved', payload: { note: 'n' } } },
        },
      });
      expect(host.scheduleDurableResume).toHaveBeenCalledWith(OWNER_ID);
      expect(response).toMatchObject({ status: 'queued', pendingApproval: null });
    });

    it('releases the claim and conflicts when neither the runtime nor a durable restart can resume', async () => {
      const { service, executionRepository, host } = createService(pausedExecution({ snapshot: null }));
      host.resumeApprovalRuntime.mockImplementation((_request, callback) => { callback(null, { resumed: false }); });

      await expect(service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved' })).rejects.toBeInstanceOf(ConflictException);

      expect(executionRepository.answerHitlEvent).not.toHaveBeenCalled();
      expect(executionRepository.transition).toHaveBeenLastCalledWith(EXECUTION_ID, expect.objectContaining({ from: ['running'], patch: { status: 'pending_approval' } }));
    });

    it('checks shared write access for another user and rejects a run that is not paused', async () => {
      const { service, accessService } = createService();
      await service.resumeApproval(EXECUTION_ID, '64b0000000000000000000ff', { decision: 'approved' });
      expect(accessService.assertExecutionAccess).toHaveBeenCalledWith(FLOW_ID, '64b0000000000000000000ff', 'write');

      const running = createService(pausedExecution({ status: 'running' }));
      await expect(running.service.resumeApproval(EXECUTION_ID, OWNER_ID, { decision: 'approved' })).rejects.toBeInstanceOf(BadRequestException);
      expect(running.executionRepository.transition).not.toHaveBeenCalled();
    });

    it('remembers the answer for future runs when asked to', async () => {
      const { service, hitlMemoryRepository, streamEvents } = createService();

      await service.resumeApproval(EXECUTION_ID, OWNER_ID, {
        decision: 'approved', payload: { remember: true, scope: 'future_node_runs', feedback: 'Always cite sources' },
      });

      expect(hitlMemoryRepository.create).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        flowId: FLOW_ID,
        nodeId: 'review',
        memoryType: 'procedural',
        source: 'hitl_feedback',
        title: 'HITL guidance for Review draft',
        content: 'Always cite sources',
        normalizedInstruction: 'Always cite sources',
        appliesTo: 'node',
        status: 'active',
        sensitivity: 'normal',
        createdFromExecutionId: EXECUTION_ID,
        createdFromInterruptId: 'int-1',
      });
      expect(streamEvents.emitHitlMemorySaved).toHaveBeenCalledWith(EXECUTION_ID, { taskId: 'review', scope: 'future_node_runs', interruptId: 'int-1' });
    });
  });

  describe('resumeFromStep', () => {
    it('answers the step interrupt only while the run is still paused', async () => {
      const { service, executionRepository, host } = createService();

      const response = await service.resumeFromStep(EXECUTION_ID, OWNER_ID, {
        taskId: 'review', interruptId: 'int-1', action: 'reply', message: 'Use the Q3 numbers',
      });

      expect(host.resumeFromStepRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ execution_id: EXECUTION_ID, node_id: 'review', iteration: 1, interrupt_id: 'int-1', action: 'reply' }),
        expect.any(Function),
      );
      expect(executionRepository.transition).not.toHaveBeenCalled();
      expect(executionRepository.answerHitlEvent).toHaveBeenCalledWith(EXECUTION_ID, {
        from: ['pending_approval'],
        interruptId: 'int-1',
        response: { action: 'reply', message: 'Use the Q3 numbers', approved: null, reason: null, feedback: null, scope: 'step_only', remember: false },
        patch: { status: 'running', pendingApproval: null },
      });
      expect(response).toMatchObject({ status: 'running', pendingApproval: null });
    });

    it('answers a lost race with the current state of the run', async () => {
      const { service, executionRepository, streamEvents } = createService();
      executionRepository.answerHitlEvent.mockResolvedValueOnce(false);
      executionRepository.findById
        .mockResolvedValueOnce(pausedExecution())
        .mockResolvedValueOnce(pausedExecution({ status: 'running', pendingApproval: null }));

      const response = await service.resumeFromStep(EXECUTION_ID, OWNER_ID, { taskId: 'review', interruptId: 'int-1', action: 'reply' });

      expect(response).toMatchObject({ status: 'running', pendingApproval: null });
      expect(streamEvents.emitHitlInterruptResolved).not.toHaveBeenCalled();
    });

    it('routes a human-approval node to the approval claim', async () => {
      const { service, executionRepository, host } = createService(pausedExecution({ snapshot: { nodes: [{ id: 'review', kind: 'human_approval' }] } }));

      await service.resumeFromStep(EXECUTION_ID, OWNER_ID, { taskId: 'review', interruptId: 'int-1', action: 'approve' });

      expect(host.resumeApprovalRuntime).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approved' }), expect.any(Function));
      expect(executionRepository.transition).toHaveBeenCalledWith(EXECUTION_ID, expect.objectContaining({ from: ['pending_approval'], pendingApproval: CLAIM }));
    });

    it('restarts a forgotten step interrupt durably, from the paused state', async () => {
      const { service, executionRepository, host } = createService();
      host.resumeFromStepRuntime.mockImplementation((_request, callback) => { callback(null, { resumed: false }); });

      const response = await service.resumeFromStep(EXECUTION_ID, OWNER_ID, { taskId: 'review', action: 'reply', message: 'go' });

      expect(executionRepository.answerHitlEvent).toHaveBeenCalledWith(EXECUTION_ID, expect.objectContaining({
        from: ['running', 'pending_approval'],
        interruptId: 'int-1',
        patch: expect.objectContaining({ status: 'queued', queuePosition: 0, pendingApproval: null }),
      }));
      expect(response).toMatchObject({ status: 'queued' });
    });

    it('hides a run of another owner and rejects a different step', async () => {
      const { service } = createService();
      await expect(service.resumeFromStep(EXECUTION_ID, '64b0000000000000000000ff', { taskId: 'review' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resumeFromStep(EXECUTION_ID, OWNER_ID, { taskId: 'other' })).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
