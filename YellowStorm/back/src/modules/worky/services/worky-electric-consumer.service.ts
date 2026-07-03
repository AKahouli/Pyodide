import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client';
import { LoggerService } from '../../logger';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyTaskResult, WorkyTaskResultDocument } from '../schemas/worky-task-result.schema';
import { WorkyElectricCursor, WorkyElectricCursorDocument } from '../schemas/worky-electric-cursor.schema';
import { PgWorkyTaskRow, PgWorkyTaskResultRow } from '../electric/worky-electric.contract';
import { mapPgTask, mapPgTaskResult } from '../electric/worky-electric.mapper';

/**
 * Nest-side `ShapeStream` consumer that mirrors the manager's Postgres rows
 * (synced via Electric SQL) into Mongo and re-broadcasts a `WorkyEvent` over
 * the existing SSE channel (`WorkyEventService.emit`).
 *
 * Scope: `tasks` + `task_results` only (canonical §Electric sync). Messages
 * and interactions have mappers (Task 6) but their Mongo schemas don't yet
 * carry an idempotency key (external PG id) — wiring those shapes is
 * deferred to a follow-up task.
 *
 * Resume: each shape's Electric `handle`+`offset` is persisted in
 * `WorkyElectricCursor` after every processed batch, so a restart resumes
 * the shape log rather than re-streaming from scratch.
 */
@Injectable()
export class WorkyElectricConsumerService implements OnModuleInit, OnModuleDestroy {
  private streams: Array<{ unsubscribe: () => void }> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly streamService: WorkyStreamService,
    private readonly events: WorkyEventService,
    private readonly logger: LoggerService,
    @InjectModel(WorkyTask.name) private readonly taskModel: Model<WorkyTaskDocument>,
    @InjectModel(WorkyTaskResult.name) private readonly resultModel: Model<WorkyTaskResultDocument>,
    @InjectModel(WorkyElectricCursor.name) private readonly cursorModel: Model<WorkyElectricCursorDocument>,
  ) {
    this.logger.setContext(WorkyElectricConsumerService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.subscribe(
      'tasks',
      this.config.get<string>('worky.electricTasksTable')!,
      (m) => this.handleTaskMessages(m),
    );
    await this.subscribe(
      'task_results',
      this.config.get<string>('worky.electricTaskResultsTable')!,
      (m) => this.handleTaskResultMessages(m),
    );
    // messages + interactions follow the same subscribe(...) shape once
    // their Mongo schemas carry an idempotency key (Task 6 mappers already
    // exist: mapPgMessage / mapPgInteraction) — out of scope for this task.
  }

  onModuleDestroy(): void {
    for (const s of this.streams) {
      try {
        s.unsubscribe();
      } catch {
        /* noop */
      }
    }
  }

  private async subscribe(
    shape: string,
    table: string,
    handler: (messages: unknown[]) => Promise<void>,
  ): Promise<void> {
    const cursor = await this.cursorModel.findOne({ shape }).lean<{ handle?: string | null; offset?: string | null }>().exec();
    const stream = new ShapeStream({
      url: this.config.get<string>('worky.electricUrl')!,
      params: { table },
      handle: cursor?.handle ?? undefined,
      offset: (cursor?.offset as never) ?? undefined,
    });
    const unsubscribe = stream.subscribe(
      async (messages) => {
        await handler(messages);
        await this.persistCursor(shape, stream.shapeHandle, String(stream.lastOffset));
      },
      (err) => this.logger.error('Electric stream error', { shape, error: (err as Error).message }),
    );
    this.streams.push({ unsubscribe });
  }

  async persistCursor(shape: string, handle: string | undefined, offset: string): Promise<void> {
    await this.cursorModel
      .updateOne({ shape }, { $set: { handle: handle ?? null, offset } }, { upsert: true })
      .exec();
  }

  async handleTaskMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m) || !isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      const row = m.value as unknown as PgWorkyTaskRow;
      const target = await this.streamService.findByAiSessionId(row.session_id);
      if (!target) {
        this.logger.warn('Task for unknown session', { session: row.session_id });
        continue;
      }
      const { set, event } = mapPgTask(row, target.streamId);
      await this.taskModel
        .findOneAndUpdate(
          { streamId: target.streamId, externalId: row.id },
          { $set: set },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      this.events.emit(target.ownerUserId, target.streamId, event);
    }
  }

  async handleTaskResultMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m) || !isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      const row = m.value as unknown as PgWorkyTaskResultRow;
      const task = await this.taskModel
        .findOne({ externalId: row.task_id })
        .lean<{ _id: unknown; streamId: unknown }>()
        .exec();
      if (!task) {
        this.logger.warn('Result for unknown task', { task: row.task_id });
        continue;
      }
      const streamId = String(task.streamId);
      const mapped = mapPgTaskResult(row, String(task._id));
      await this.resultModel
        .findOneAndUpdate(
          { taskId: mapped.taskId, version: mapped.version },
          { $set: mapped.set },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      const owner = await this.streamService.getOwnerByStreamId(streamId);
      if (owner) this.events.emit(owner, streamId, mapped.event);
    }
  }
}
