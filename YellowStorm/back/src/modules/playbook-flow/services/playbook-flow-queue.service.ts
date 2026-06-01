import { Injectable, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../schemas/playbook-flow-execution.schema';

const ACTIVE_STATUSES = ['running', 'pending_approval'] as const;

@Injectable()
export class PlaybookFlowQueueService {
  private readonly logger = new Logger(PlaybookFlowQueueService.name);

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
  ) {}

  /**
   * Admit an execution to the queue. Returns the queue position, or -1 if queue is full.
   * Does NOT promote to running — use claimNext() for atomic promotion.
   */
  async admit(
    ownerId: string,
    executionId: string,
    maxConcurrent: number,
    maxDepth: number,
  ): Promise<number> {
    const queuedCount = await this.executionModel.countDocuments({
      ownerId,
      status: 'queued',
      _id: { $ne: executionId },
    });

    if (queuedCount >= maxDepth) {
      return -1;
    }

    const position = queuedCount + 1;
    await this.executionModel.findByIdAndUpdate(executionId, { queuePosition: position }).exec();
    return position;
  }

  /**
   * Atomically claim the oldest queued execution for an owner if capacity is available.
   * Returns the claimed execution document, or null if no queued execution is available.
   */
  async claimNext(ownerId: string, maxConcurrent: number): Promise<FlowExecutionDocument | null> {
    const activeCount = await this.executionModel.countDocuments({
      ownerId,
      status: { $in: ACTIVE_STATUSES },
    });

    if (activeCount >= maxConcurrent) return null;

    const next = await this.executionModel.findOneAndUpdate(
      { ownerId, status: 'queued' },
      { status: 'running', queuePosition: 0, startedAt: new Date() },
      { sort: { createdAt: 1 }, new: true },
    ).select('+snapshot replaySource').exec();

    if (!next) return null;

    // Safety net: if a concurrent claim race exceeded capacity, revert.
    const activeAfter = await this.executionModel.countDocuments({
      ownerId, status: { $in: ACTIVE_STATUSES },
    });
    if (activeAfter > maxConcurrent) {
      this.logger.warn(`Slot over-claimed for owner ${ownerId}, reverting ${next.id}`);
      await this.executionModel.findByIdAndUpdate(next.id, {
        status: 'queued',
        queuePosition: activeCount + 1,
      }).exec();
      await this.executionModel.updateOne({ _id: next.id }, { $unset: { startedAt: 1 } }).exec();
      return null;
    }

    this.logger.log(`Claimed queued execution ${next.id} for owner ${ownerId}`);
    return next;
  }

  /**
   * Recompute queue positions for all queued executions belonging to owner.
   * Returns the changed { executionId, queuePosition } pairs for SSE updates.
   */
  async refreshPositions(ownerId: string): Promise<Array<{ executionId: string; queuePosition: number }>> {
    const queued = await this.executionModel
      .find({ ownerId, status: 'queued' })
      .sort({ createdAt: 1 })
      .lean();

    const changes: Array<{ executionId: string; queuePosition: number }> = [];

    for (let i = 0; i < queued.length; i++) {
      const newPosition = i + 1;
      const exec = queued[i] as unknown as Record<string, unknown>;
      const id = String(exec._id);
      if ((exec.queuePosition as number) !== newPosition) {
        await this.executionModel.findByIdAndUpdate(id, { queuePosition: newPosition }).exec();
        changes.push({ executionId: id, queuePosition: newPosition });
      }
    }

    return changes;
  }

  async getQueuePosition(ownerId: string, executionId: string): Promise<number> {
    const execution = await this.executionModel.findById(executionId, { queuePosition: 1 }).lean();
    if (!execution) return 0;
    return (execution as unknown as Record<string, unknown>).queuePosition as number ?? 0;
  }

  async getRunningCount(ownerId: string): Promise<number> {
    return this.executionModel.countDocuments({ ownerId, status: { $in: ACTIVE_STATUSES } });
  }

  /**
   * Release a running slot for the owner and attempt to drain one queued execution.
   */
  async release(ownerId: string, maxConcurrent: number): Promise<FlowExecutionDocument | null> {
    return this.claimNext(ownerId, maxConcurrent);
  }
}
