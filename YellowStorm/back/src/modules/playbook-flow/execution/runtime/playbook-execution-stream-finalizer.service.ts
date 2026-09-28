import { Injectable, Logger, Optional } from '@nestjs/common';
import { EXECUTION_OPEN_STATUSES, ExecutionRepository } from '../../persistence/execution.repository';
import { TaskResultRepository } from '../../persistence/task-result.repository';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowExecutionLeaseService } from '../../services/playbook-flow-execution-lease.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';
import { sanitizePlaybookPublicValue } from '../../utils/playbook-artifact';

/**
 * Finalizes runtime streams after gRPC completion so execution status updates,
 * token flushing, and outbound stream events stay aligned across run modes.
 */
@Injectable()
export class PlaybookExecutionStreamFinalizerService {
  private readonly logger = new Logger(PlaybookExecutionStreamFinalizerService.name);

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
    @Optional() private readonly executionLeaseService?: PlaybookFlowExecutionLeaseService,
  ) {}

  async finalizeErroredStream(executionId: string, errorMessage: string): Promise<void> {
    const publicErrorMessage = String(sanitizePlaybookPublicValue(errorMessage));
    await this.executionRepository.update(executionId, {
      status: 'failed',
      endedAt: new Date(),
      error: publicErrorMessage,
    });
    await this.tokenBufferService?.flushExecution(executionId);
    await this.executionLeaseService?.release(executionId);
    this.streamEvents.emitExecutionComplete(executionId, 'failed', publicErrorMessage);
  }

  async finalizeEndedStream(executionId: string): Promise<boolean> {
    const execution = await this.executionRepository.findById(executionId);
    const status = String(execution?.status || '');
    if (!this.shouldFinalize(status)) {
      return false;
    }

    const failedTask = await this.taskResultRepository.findLatestFailed(executionId);
    if (failedTask) {
      const errorMessage = String(sanitizePlaybookPublicValue(failedTask.error || 'Execution failed'));
      const failed = await this.executionRepository.transition(executionId, {
        from: EXECUTION_OPEN_STATUSES,
        patch: { status: 'failed', error: errorMessage, endedAt: new Date() },
      });
      if (failed) {
        await this.executionLeaseService?.release(executionId);
        this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
        return true;
      }

      this.logger.warn(`Stream failure finalization skipped for execution ${executionId} because the execution was already terminal`);
      return false;
    }

    const completed = await this.executionRepository.transition(executionId, {
      from: ['queued', 'running'],
      patch: { status: 'completed', endedAt: new Date() },
    });
    if (!completed) {
      return false;
    }

    await this.executionLeaseService?.release(executionId);
    this.streamEvents.emitExecutionComplete(executionId, 'completed');
    return true;
  }

  private shouldFinalize(status: string): boolean {
    return status !== 'cancelled'
      && status !== 'pending_approval'
      && status !== 'failed'
      && status !== 'completed';
  }
}
