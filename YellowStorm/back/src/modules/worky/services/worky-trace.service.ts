import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyTrace,
  WorkyTraceDocument,
} from '../schemas/worky-trace.schema';
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
    @InjectModel(WorkyTrace.name)
    private readonly traces: Model<WorkyTraceDocument>,
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
    if (!Types.ObjectId.isValid(input.streamId)) {
      throw new Error(`WorkyTraceService.record: invalid streamId`);
    }
    if (!Types.ObjectId.isValid(input.taskId)) {
      throw new Error(`WorkyTraceService.record: invalid taskId`);
    }
    const doc = await this.traces.create({
      streamId: new Types.ObjectId(input.streamId),
      taskId: new Types.ObjectId(input.taskId),
      kind: input.kind,
      name: input.name,
      summary: input.summary ?? '',
      rawPayloadUri: input.rawPayloadUri ?? null,
      durationMs: input.durationMs ?? 0,
    });
    // Returned shape intentionally includes the raw payload URI; this
    // is the internal `record()` path, not the public list endpoint
    // that must redact by default.
    return this.toResponse(doc, false);
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
    if (!Types.ObjectId.isValid(streamId)) return [];
    const docs = await this.traces
      .find({ streamId: new Types.ObjectId(streamId) })
      .sort({ createdAt: 1 })
      .limit(500)
      .exec();
    return docs.map((d) => this.toResponse(d, options.redactRawPayload !== false));
  }

  async listForTask(
    streamId: string,
    taskId: string,
    options: { redactRawPayload?: boolean } = { redactRawPayload: true },
  ): Promise<IWorkyTraceResponse[]> {
    if (!Types.ObjectId.isValid(streamId) || !Types.ObjectId.isValid(taskId)) return [];
    const docs = await this.traces
      .find({ streamId: new Types.ObjectId(streamId), taskId: new Types.ObjectId(taskId) })
      .sort({ createdAt: 1 })
      .limit(200)
      .exec();
    return docs.map((d) => this.toResponse(d, options.redactRawPayload !== false));
  }

  private toResponse(doc: WorkyTraceDocument, redactRawPayload = true): IWorkyTraceResponse {
    return {
      id: doc._id.toString(),
      streamId: doc.streamId.toString(),
      taskId: doc.taskId.toString(),
      kind: doc.kind,
      name: doc.name,
      summary: doc.summary,
      rawPayloadUri: redactRawPayload ? null : doc.rawPayloadUri ?? null,
      durationMs: doc.durationMs,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
