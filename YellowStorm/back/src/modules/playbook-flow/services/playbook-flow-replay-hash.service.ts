import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  FlowReplayFingerprints,
  type ReplayFingerprintInput,
} from '../models/playbook-flow-validated-replay.model';

const VOLATILE_KEYS = new Set([
  '_id',
  'id',
  '__v',
  'createdAt',
  'updatedAt',
  'startedAt',
  'endedAt',
  'timestamp',
  'timestamps',
  'durationMs',
  'usage',
  'referenceUsage',
  'llmPromptTrace',
  'prompt',
  'traceMetadata',
  'status',
  'runtimeStatus',
  'queuePosition',
  'tokenUsage',
  'semanticMatch',
  'stepReplayMode',
  'positionX',
  'positionY',
]);

@Injectable()
export class PlaybookFlowReplayHashService {
  buildHash(value: unknown): string {
    return createHash('sha256')
      .update(this.buildStableJson(value))
      .digest('hex');
  }

  buildReplayFingerprints(params: ReplayFingerprintInput): FlowReplayFingerprints {
    return {
      inputContextHash: this.hashOrNull(params.inputContext),
      flowSnapshotHash: this.hashOrNull(params.flowSnapshot),
      nodeSnapshotHash: this.hashOrNull(params.nodeSnapshot),
      agentConfigHash: this.hashOrNull(params.agentConfig),
      modelConfigHash: this.hashOrNull(params.modelConfig),
      toolConfigHash: this.hashOrNull(params.toolConfig),
      outputContractHash: this.hashOrNull(params.outputContract),
    };
  }

  private hashOrNull(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) {
      return null;
    }

    if (Array.isArray(value) && value.length === 0) {
      return null;
    }

    return this.buildHash(value);
  }

  private buildStableJson(value: unknown): string {
    return JSON.stringify(this.normalizeValue(value));
  }

  private normalizeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (typeof value !== 'object') {
      return value;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right));

    return entries.reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = this.normalizeValue(entry);
      return acc;
    }, {});
  }
}
