import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { FlowReplayValidationStatus } from '../schemas/playbook-flow-validated-replay.schema';

function createReplayServiceForTests(overrides?: {
  executionModel?: Record<string, any>;
  taskResultModel?: Record<string, any>;
  routerDecisionModel?: Record<string, any>;
  replayModel?: Record<string, any>;
  executionService?: Record<string, any>;
  logger?: Record<string, any>;
}) {
  const executionModel = {
    findOne: jest.fn(),
    ...overrides?.executionModel,
  };
  const taskResultModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    ...overrides?.taskResultModel,
  };
  const routerDecisionModel = {
    find: jest.fn(),
    ...overrides?.routerDecisionModel,
  };
  const replayModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    deleteOne: jest.fn(),
    ...overrides?.replayModel,
  };
  const executionService = {
    start: jest.fn(),
    ...overrides?.executionService,
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    ...overrides?.logger,
  };

  const service = new PlaybookFlowReplayService(
    executionModel as any,
    taskResultModel as any,
    routerDecisionModel as any,
    replayModel as any,
    executionService as any,
    logger as any,
  );

  return {
    service,
    executionModel,
    taskResultModel,
    routerDecisionModel,
    replayModel,
    executionService,
    logger,
  };
}

function makeFindOneChain(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function makeFindChain(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('PlaybookFlowReplayService', () => {
  describe('traceReplay', () => {
    it('reconstructs a linear flow with 3 completed nodes', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:00:00Z');
      const t2 = new Date('2026-01-01T00:01:00Z');
      const t3 = new Date('2026-01-01T00:02:00Z');
      const t4 = new Date('2026-01-01T00:03:00Z');
      const t5 = new Date('2026-01-01T00:04:00Z');
      const t6 = new Date('2026-01-01T00:05:00Z');
      const tEnd = new Date('2026-01-01T00:06:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', status: 'completed', endedAt: tEnd,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        { taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'hello' },
        { taskId: 'step-2', iteration: 0, status: 'completed', startedAt: t3, endedAt: t4, output: 'world' },
        { taskId: 'step-3', iteration: 0, status: 'completed', startedAt: t5, endedAt: t6, output: 'done' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([]));

      const events = await service.traceReplay('exec-1', 'user-1');

      expect(events).toHaveLength(7);
      expect(events[0].type).toBe('NodeStarted');
      expect(events[0].data).toMatchObject({ taskId: 'step-1', iteration: 0 });
      expect(events[1].type).toBe('NodeCompleted');
      expect(events[1].data).toMatchObject({ taskId: 'step-1', output: 'hello' });
      expect(events[6].type).toBe('ExecutionCompleted');
    });

    it('includes router decision events sorted by timestamp', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t1 = new Date('2026-01-01T00:01:00Z');
      const t2 = new Date('2026-01-01T00:02:00Z');
      const t3 = new Date('2026-01-01T00:03:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-2', ownerId: 'user-1', status: 'completed', endedAt: t3,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        { taskId: 'step-1', iteration: 0, status: 'completed', startedAt: t1, endedAt: t2, output: 'ok' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([
        { routerNodeId: 'router-1', iteration: 0, label: 'retry', decidedAt: new Date('2026-01-01T00:01:30Z') },
      ]));

      const events = await service.traceReplay('exec-2', 'user-1');

      const routerEvents = events.filter(e => e.type === 'RouterDecision');
      expect(routerEvents).toHaveLength(1);
      expect(routerEvents[0].data).toMatchObject({ routerNodeId: 'router-1', label: 'retry' });
    });

    it('emits NodeFailed when task result status is failed', async () => {
      const { service, executionModel, taskResultModel, routerDecisionModel } = createReplayServiceForTests();

      const t = new Date('2026-01-01T00:01:00Z');

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-3', ownerId: 'user-1', status: 'failed', endedAt: t,
      }));

      taskResultModel.find.mockReturnValue(makeFindChain([
        { taskId: 'step-1', iteration: 0, status: 'failed', startedAt: t, endedAt: t, error: 'LLM error' },
      ]));

      routerDecisionModel.find.mockReturnValue(makeFindChain([]));

      const events = await service.traceReplay('exec-3', 'user-1');

      const failedEvents = events.filter(e => e.type === 'NodeFailed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].data).toMatchObject({ taskId: 'step-1', error: 'LLM error' });
      expect(events[events.length - 1].type).toBe('ExecutionFailed');
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(service.traceReplay('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reExecute', () => {
    it('calls executionService.start with the original flowId and inputContext', async () => {
      const { service, executionModel, executionService } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1',
        inputContext: { query: 'hello' },
      }));

      executionService.start.mockResolvedValue({ id: 'exec-42' });

      const result = await service.reExecute('exec-1', 'user-1');

      expect(executionService.start).toHaveBeenCalledWith('flow-1', 'user-1', { query: 'hello' });
      expect(result.executionId).toBe('exec-42');
      expect(result.divergenceWarning).toBe(true);
    });

    it('throws NotFoundException for non-existent execution', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(service.reExecute('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateTaskReplay', () => {
    it('creates a validated replay entry with incremented version', async () => {
      const { service, executionModel, taskResultModel, replayModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', status: 'completed',
      }));

      taskResultModel.findOne.mockReturnValue(makeFindOneChain({
        executionId: 'exec-1', taskId: 'step-1', iteration: 0,
        output: 'original output',
      }));

      replayModel.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      replayModel.create.mockResolvedValue([{
        flowId: 'flow-1', taskId: 'step-1', iteration: 0, validationVersion: 1,
        status: FlowReplayValidationStatus.ACTIVE,
      }]);
      replayModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1');

      expect(result.validationVersion).toBe(1);
      expect(result.status).toBe(FlowReplayValidationStatus.ACTIVE);
    });

    it('throws NotFoundException when execution not found', async () => {
      const { service, executionModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(
        service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when task result not found', async () => {
      const { service, executionModel, taskResultModel } = createReplayServiceForTests();

      executionModel.findOne.mockReturnValue(makeFindOneChain({
        id: 'exec-1', ownerId: 'user-1', status: 'completed',
      }));

      taskResultModel.findOne.mockReturnValue(makeFindOneChain(null));

      await expect(
        service.validateTaskReplay('user-1', 'flow-1', 'step-1', 0, 'exec-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activateTaskReplay', () => {
    it('deactivates all other replays and activates the target', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1',
        status: FlowReplayValidationStatus.ACTIVE,
      });

      const result = await service.activateTaskReplay('flow-1', 'step-1', 'replay-1');

      expect(replayModel.updateMany).toHaveBeenCalledWith(
        { flowId: 'flow-1', taskId: 'step-1', status: FlowReplayValidationStatus.ACTIVE },
        { status: FlowReplayValidationStatus.INACTIVE },
      );
      expect(result.status).toBe(FlowReplayValidationStatus.ACTIVE);
    });

    it('throws NotFoundException when replay not found', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.updateMany.mockResolvedValue({ modifiedCount: 0 });
      replayModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.activateTaskReplay('flow-1', 'step-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTaskReplayFormatGuide', () => {
    it('updates output format guide fields', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1',
        preserveOutputFormat: true, outputFormatGuide: 'JSON array',
      });

      const result = await service.updateTaskReplayFormatGuide('flow-1', 'step-1', 'replay-1', {
        preserveOutputFormat: true, outputFormatGuide: 'JSON array',
      });

      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: { outputFormatGuide: 'JSON array', preserveOutputFormat: true } },
        { new: true },
      );
      expect(result.preserveOutputFormat).toBe(true);
    });
  });

  describe('updateTaskReplayLabel', () => {
    it('updates the label on the replay', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOneAndUpdate.mockResolvedValue({
        _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1', label: 'v2',
      });

      const result = await service.updateTaskReplayLabel('flow-1', 'step-1', 'replay-1', 'v2');

      expect(replayModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'replay-1', flowId: 'flow-1', taskId: 'step-1' },
        { $set: { label: 'v2' } },
        { new: true },
      );
      expect(result.label).toBe('v2');
    });
  });

  describe('deleteTaskReplay', () => {
    it('deletes the replay document', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await expect(service.deleteTaskReplay('flow-1', 'step-1', 'replay-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundException when nothing deleted', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

      await expect(service.deleteTaskReplay('flow-1', 'step-1', 'replay-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getActiveReplay', () => {
    it('returns the active replay for a flow and task', async () => {
      const { service, replayModel } = createReplayServiceForTests();

      replayModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ taskId: 'step-1', status: 'active' }) });

      const result = await service.getActiveReplay('flow-1', 'step-1');

      expect(result).not.toBeNull();
    });
  });
});
