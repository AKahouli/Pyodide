import { Injectable } from '@nestjs/common';
import type {
  PlaybookIntentTraceEntry,
  PlaybookIntentTraceResponse,
  PlaybookIntentTraceStage,
} from '../interfaces/playbook-flow-intent-trace.interface';

const DEFAULT_TRACE_CAPACITY = 10;

@Injectable()
export class PlaybookFlowIntentTraceService {
  private readonly capacity = DEFAULT_TRACE_CAPACITY;
  private readonly buffers = new Map<string, PlaybookIntentTraceEntry[]>();

  push(userId: string, flowId: string, entry: PlaybookIntentTraceEntry): void {
    const buffer = this.getOrCreateBuffer(userId, flowId);
    buffer.push(entry);
    while (buffer.length > this.capacity) {
      buffer.shift();
    }
  }

  list(userId: string, flowId: string): PlaybookIntentTraceResponse {
    const buffer = this.buffers.get(this.key(userId, flowId)) ?? [];
    return {
      intentAnalyze: buffer.filter((entry) => entry.stage === 'intent.analyze'),
      designAssessment: buffer.filter((entry) => entry.stage === 'intent.design_assessment'),
    };
  }

  latest(userId: string, flowId: string, stage: PlaybookIntentTraceStage): PlaybookIntentTraceEntry | null {
    const buffer = this.buffers.get(this.key(userId, flowId));
    if (!buffer) return null;
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      if (buffer[index].stage === stage) return buffer[index];
    }
    return null;
  }

  clear(userId: string, flowId: string): void {
    this.buffers.delete(this.key(userId, flowId));
  }

  private getOrCreateBuffer(userId: string, flowId: string): PlaybookIntentTraceEntry[] {
    const key = this.key(userId, flowId);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = [];
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private key(userId: string, flowId: string): string {
    return `${userId}::${flowId}`;
  }
}