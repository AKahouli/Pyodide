import { Test } from '@nestjs/testing';
import { PlaybookExecutionStreamFinalizerService } from './playbook-execution-stream-finalizer.service';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { TaskResultRepository } from '../../persistence/task-result.repository';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowExecutionLeaseService } from '../../services/playbook-flow-execution-lease.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';

describe('PlaybookExecutionStreamFinalizerService', () => {
  const executionRepository = {
    update: jest.fn(),
    findById: jest.fn(),
    transition: jest.fn(),
  };
  const taskResultRepository = {
    findLatestFailed: jest.fn(),
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
    executionRepository.update.mockResolvedValue(true);
    executionRepository.findById.mockResolvedValue({ status: 'running' });
    executionRepository.transition.mockResolvedValue(true);
    taskResultRepository.findLatestFailed.mockResolvedValue(null);
    executionLeaseService.release.mockResolvedValue(undefined);
    tokenBufferService.flushExecution.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookExecutionStreamFinalizerService,
        { provide: ExecutionRepository, useValue: executionRepository },
        { provide: TaskResultRepository, useValue: taskResultRepository },
        { provide: PlaybookFlowStreamEventsService, useValue: streamEvents },
        { provide: PlaybookFlowExecutionLeaseService, useValue: executionLeaseService },
        { provide: PlaybookFlowTokenBufferService, useValue: tokenBufferService },
      ],
    }).compile();

    service = moduleRef.get(PlaybookExecutionStreamFinalizerService);
  });

  it('finalizes errored streams as failed and flushes buffered tokens', async () => {
    await service.finalizeErroredStream('exec-1', 'boom');

    expect(executionRepository.update).toHaveBeenCalledWith(
      'exec-1',
      expect.objectContaining({ status: 'failed', error: 'boom', endedAt: expect.any(Date) }),
    );
    expect(tokenBufferService.flushExecution).toHaveBeenCalledWith('exec-1');
    expect(executionLeaseService.release).toHaveBeenCalledWith('exec-1');
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-1', 'failed', 'boom');
  });

  it('marks a run stream as failed when a failed task exists at end-of-stream', async () => {
    taskResultRepository.findLatestFailed.mockResolvedValue({ error: 'task failed' });

    const completed = await service.finalizeEndedStream('exec-2');

    expect(completed).toBe(true);
    expect(taskResultRepository.findLatestFailed).toHaveBeenCalledWith('exec-2');
    expect(executionRepository.transition).toHaveBeenCalledWith('exec-2', {
      from: ['queued', 'running', 'pending_approval'],
      patch: expect.objectContaining({ status: 'failed', error: 'task failed', endedAt: expect.any(Date) }),
    });
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-2', 'failed', 'task failed');
  });

  it('skips the failure when another writer already ended the run', async () => {
    taskResultRepository.findLatestFailed.mockResolvedValue({ error: 'task failed' });
    executionRepository.transition.mockResolvedValue(false);

    await expect(service.finalizeEndedStream('exec-2')).resolves.toBe(false);

    expect(executionLeaseService.release).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionComplete).not.toHaveBeenCalled();
  });

  it('marks a replay stream as completed when no failed task exists', async () => {
    const completed = await service.finalizeEndedStream('exec-3');

    expect(completed).toBe(true);
    expect(executionRepository.transition).toHaveBeenCalledWith('exec-3', {
      from: ['queued', 'running'],
      patch: expect.objectContaining({ status: 'completed', endedAt: expect.any(Date) }),
    });
    expect(executionLeaseService.release).toHaveBeenCalledWith('exec-3');
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-3', 'completed');
  });

  it('leaves a paused or terminal run alone', async () => {
    for (const status of ['pending_approval', 'cancelled', 'completed', 'failed']) {
      executionRepository.findById.mockResolvedValueOnce({ status });
      await expect(service.finalizeEndedStream('exec-4')).resolves.toBe(false);
    }
    expect(executionRepository.transition).not.toHaveBeenCalled();
  });
});
