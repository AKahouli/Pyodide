import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlaybookExecutionStreamFinalizerService } from './playbook-execution-stream-finalizer.service';
import { FlowExecution } from '../../schemas/playbook-flow-execution.schema';
import { FlowTaskResult } from '../../schemas/playbook-flow-task-result.schema';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowExecutionLeaseService } from '../../services/playbook-flow-execution-lease.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';

describe('PlaybookExecutionStreamFinalizerService', () => {
  const executionModel = {
    findByIdAndUpdate: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
  };
  const taskResultModel = {
    findOne: jest.fn(),
  };
  const streamEvents = {
    emitExecutionComplete: jest.fn(),
  };
  const executionLeaseService = {
    release: jest.fn(),
  };
  const tokenBufferService = {
    flushExecution: jest.fn(),
  };

  let service: PlaybookExecutionStreamFinalizerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    executionModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    executionModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'running' }) });
    executionModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
    taskResultModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    executionLeaseService.release.mockResolvedValue(undefined);
    tokenBufferService.flushExecution.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookExecutionStreamFinalizerService,
        { provide: getModelToken(FlowExecution.name), useValue: executionModel },
        { provide: getModelToken(FlowTaskResult.name), useValue: taskResultModel },
        { provide: PlaybookFlowStreamEventsService, useValue: streamEvents },
        { provide: PlaybookFlowExecutionLeaseService, useValue: executionLeaseService },
        { provide: PlaybookFlowTokenBufferService, useValue: tokenBufferService },
      ],
    }).compile();

    service = moduleRef.get(PlaybookExecutionStreamFinalizerService);
  });

  it('finalizes errored streams as failed and flushes buffered tokens', async () => {
    await service.finalizeErroredStream('exec-1', 'boom');

    expect(executionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'exec-1',
      expect.objectContaining({ status: 'failed', error: 'boom' }),
    );
    expect(tokenBufferService.flushExecution).toHaveBeenCalledWith('exec-1');
    expect(executionLeaseService.release).toHaveBeenCalledWith('exec-1');
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-1', 'failed', 'boom');
  });

  it('marks a run stream as failed when a failed task exists at end-of-stream', async () => {
    taskResultModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ error: 'task failed' }),
      }),
    });

    const completed = await service.finalizeEndedStream('exec-2');

    expect(completed).toBe(true);
    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-2', status: { $nin: ['completed', 'failed', 'cancelled'] } },
      expect.objectContaining({ status: 'failed', error: 'task failed' }),
    );
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-2', 'failed', 'task failed');
  });

  it('marks a replay stream as completed when no failed task exists', async () => {
    const completed = await service.finalizeEndedStream('exec-3');

    expect(completed).toBe(true);
    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-3', status: { $in: ['queued', 'running'] } },
      expect.objectContaining({ status: 'completed' }),
    );
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-3', 'completed');
  });
});
