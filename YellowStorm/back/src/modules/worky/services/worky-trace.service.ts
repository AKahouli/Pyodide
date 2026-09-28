import { Injectable } from '@nestjs/common';
import { isForeignKeyViolation, isObjectId } from '@common/postgres';
import { WorkyAuditRepository } from '../persistence/worky-audit.repository';
import type { WorkyTraceRecord } from '../worky.types';
import { LoggerService } from '../../logger';

export interface IWorkyTraceResponse {
  id: string;
  streamId: string;
  taskId: string;
  kind: string;
  name: string;
  summary: string;
  rawPayloadUri: string | null;
  durationMs: number;
  createdAt: string;
}

@Injectable()
export class WorkyTraceService {
  constructor(
    private readonly audits: WorkyAuditRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTraceService.name);
  }

  /**
   * Persist a trace summary. Idempotent on `(streamId, taskId, kind,
   * name, createdAt)` — replays are no-ops. The runtime is expected
   * to also push a cost event for the same call.
   */
  async record(input: {
    streamId: string;
    taskId: string;
    kind: 'tool' | 'model';
    name: string;
    summary?: string;
    rawPayloadUri?: string | null;
    durationMs?: number;
  }): Promise<IWorkyTraceResponse> {
    if (!isObjectId(input.streamId)) {
      throw new Error(`WorkyTraceService.record: invalid streamId`);
    }
    if (!isObjectId(input.taskId)) {
      throw new Error(`WorkyTraceService.record: invalid taskId`);
    }
    const trace = await this.audits
      .createTrace({
        streamId: input.streamId,
        taskId: input.taskId,
        kind: input.kind,
        name: input.name,
        summary: input.summary ?? '',
        rawPayloadUri: input.rawPayloadUri ?? null,
        durationMs: input.durationMs ?? 0,
      })
      .catch((err: unknown) => {
        // traces.stream_id and traces.task_id are foreign keys.
        if (isForeignKeyViolation(err)) {
          throw new Error(`WorkyTraceService.record: task ${input.taskId} not found in stream ${input.streamId}`);
        }
        throw err;
      });
    // Returned shape intentionally includes the raw payload URI; this
    // is the internal `record()` path, not the public list endpoint
    // that must redact by default.
    return this.toResponse(trace, false);
  }

  /**
   * List traces for a task. Strips `rawPayloadUri` unless the caller
   * has admin permissions (canonical §19). Pass `redactRawPayload`
   * as `false` to return the URI.
   */
  async listForStream(
    streamId: string,
    options: { redactRawPayload?: boolean } = { redactRawPayload: true },
  ): Promise<IWorkyTraceResponse[]> {
    if (!isObjectId(streamId)) return [];
    const traces = await this.audits.listTracesForStream(streamId, 500);
    return traces.map((t) => this.toResponse(t, options.redactRawPayload !== false));
  }

  async listForTask(
    streamId: string,
    taskId: string,
    options: { redactRawPayload?: boolean } = { redactRawPayload: true },
  ): Promise<IWorkyTraceResponse[]> {
    if (!isObjectId(streamId) || !isObjectId(taskId)) return [];
    const traces = await this.audits.listTracesForTask(streamId, taskId, 200);
    return traces.map((t) => this.toResponse(t, options.redactRawPayload !== false));
  }

  private toResponse(row: WorkyTraceRecord, redactRawPayload = true): IWorkyTraceResponse {
    return {
      id: row.id,
      streamId: row.streamId,
      taskId: row.taskId,
      kind: row.kind,
      name: row.name,
      summary: row.summary,
      rawPayloadUri: redactRawPayload ? null : row.rawPayloadUri ?? null,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
