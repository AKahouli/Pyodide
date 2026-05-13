import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';

@Injectable()
export class PlaybookFlowQueueService {
  private readonly userQueues = new Map<
    string,
    Array<{ executionId: string; resolve: () => void }>
  >();
  private readonly userRunning = new Map<string, number>();

  constructor(private readonly idempotencyService: PlaybookFlowIdempotencyService) {}

  async enqueue(
    userId: string,
    executionId: string,
    maxConcurrent: number,
    maxDepth: number,
  ): Promise<number> {
    const running = this.userRunning.get(userId) || 0;
    const queue = this.userQueues.get(userId) || [];

    if (running >= maxConcurrent) {
      if (queue.length >= maxDepth) {
        return -1;
      }
      return new Promise<number>((resolve) => {
        queue.push({ executionId, resolve: () => resolve(0) });
        this.userQueues.set(userId, queue);
        resolve(0);
      });
    }

    this.userRunning.set(userId, running + 1);
    return 0;
  }

  dequeue(userId: string): string | null {
    const queue = this.userQueues.get(userId);
    if (!queue || queue.length === 0) {
      const running = this.userRunning.get(userId) || 1;
      this.userRunning.set(userId, running - 1);
      return null;
    }
    const next = queue.shift()!;
    this.userQueues.set(userId, queue);
    return next.executionId;
  }

  release(userId: string): void {
    const running = this.userRunning.get(userId) || 1;
    if (running <= 1) {
      this.userRunning.delete(userId);
    } else {
      this.userRunning.set(userId, running - 1);
    }
  }

  getQueuePosition(userId: string, executionId: string): number {
    const queue = this.userQueues.get(userId) || [];
    const index = queue.findIndex((e) => e.executionId === executionId);
    return index >= 0 ? index + 1 : 0;
  }

  getRunningCount(userId: string): number {
    return this.userRunning.get(userId) || 0;
  }
}
