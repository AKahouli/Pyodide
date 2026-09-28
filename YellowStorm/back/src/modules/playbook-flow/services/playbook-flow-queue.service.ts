import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository, type ExecutionRecord } from '../persistence/execution.repository';

@Injectable()
export class PlaybookFlowQueueService {
  private readonly logger = new Logger(PlaybookFlowQueueService.name);

  constructor(private readonly executions: ExecutionRepository) {}

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
    const queuedCount = await this.executions.countQueued(ownerId, executionId);

    if (queuedCount >= maxDepth) {
      return -1;
    }

    const position = queuedCount + 1;
    await this.executions.update(executionId, { queuePosition: position });
    return position;
  }

  /**
   * Atomically claim the oldest queued execution for an owner if capacity is available.
   * Returns the claimed execution (with its snapshot), or null if no queued execution is available.
   * The repository serialises the claimers of one owner, so a slot can no longer be over-claimed
   * and the former "revert the over-claim" safety net is gone.
   */
  async claimNext(ownerId: string, maxConcurrent: number): Promise<ExecutionRecord | null> {
    const next = await this.executions.claimNextQueued(ownerId, maxConcurrent);
    if (!next) return null;

    this.logger.log(`Claimed queued execution ${next.id} for owner ${ownerId}`);
    return next;
  }

  /**
   * Recompute queue positions for all queued executions belonging to owner.
   * Returns the changed { executionId, queuePosition } pairs for SSE updates.
   */
  async refreshPositions(ownerId: string): Promise<Array<{ executionId: string; queuePosition: number }>> {
    return this.executions.renumberQueue(ownerId);
  }

  async getQueuePosition(ownerId: string, executionId: string): Promise<number> {
    const execution = await this.executions.findById(executionId);
    return execution?.queuePosition ?? 0;
  }

  async getRunningCount(ownerId: string): Promise<number> {
    return this.executions.countActive(ownerId);
  }

  /**
   * Release a running slot for the owner and attempt to drain one queued execution.
   */
  async release(ownerId: string, maxConcurrent: number): Promise<ExecutionRecord | null> {
    return this.claimNext(ownerId, maxConcurrent);
  }
}
