import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../../schemas/playbook-flow-execution.schema';
import {
  FlowTaskResult,
  FlowTaskResultDocument,
} from '../../schemas/playbook-flow-task-result.schema';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowExecutionLeaseService } from '../../services/playbook-flow-execution-lease.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/**
 * Finalizes runtime streams after gRPC completion so execution status updates,
 * token flushing, and outbound stream events stay aligned across run modes.
 */
@Injectable()
export class PlaybookExecutionStreamFinalizerService {
  private readonly logger = new Logger(PlaybookExecutionStreamFinalizerService.name);

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
    @Optional() private readonly executionLeaseService?: PlaybookFlowExecutionLeaseService,
  ) {}

  async finalizeErroredStream(executionId: string, errorMessage: string): Promise<void> {
    await this.executionModel
      .findByIdAndUpdate(executionId, {
        status: 'failed',
        endedAt: new Date(),
        error: errorMessage,
      })
      .exec();
    await this.tokenBufferService?.flushExecution(executionId);
    await this.executionLeaseService?.release(executionId);
    this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
  }

  async finalizeEndedStream(executionId: string, allowFailedTaskFallback: boolean): Promise<boolean> {
    const execution = await this.executionModel.findById(executionId).lean();
    const status = String((execution as Record<string, unknown> | null)?.status || '');
    if (!this.shouldFinalize(status)) {
      return false;
    }

    if (allowFailedTaskFallback) {
      const failedTask = await this.taskResultModel
        .findOne({ executionId, status: 'failed' })
        .sort({ endedAt: -1 })
        .lean();
      if (failedTask) {
        const errorMessage = String(failedTask.error || 'Execution failed');
        const failedResult = await this.executionModel
          .updateOne(
            { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
            { status: 'failed', error: errorMessage, endedAt: new Date() },
          )
          .exec();
        if ((failedResult as { modifiedCount?: number }).modifiedCount) {
          await this.executionLeaseService?.release(executionId);
          this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
          return true;
        }

        this.logger.warn(`Stream failure finalization skipped for execution ${executionId} because the execution was already terminal`);
        return false;
      }
    }

    const completedResult = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $in: ['queued', 'running'] } },
        { status: 'completed', endedAt: new Date() },
      )
      .exec();
    if (!(completedResult as { modifiedCount?: number }).modifiedCount) {
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
