import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client';
import { LoggerService } from '../../logger';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyMessage, WorkyMessageDocument } from '../schemas/worky-message.schema';
import { WorkyPlanProjection, WorkyPlanProjectionDocument } from '../schemas/worky-plan-projection.schema';
import { WorkyElectricCursor, WorkyElectricCursorDocument } from '../schemas/worky-electric-cursor.schema';
import { PgMessageRow, PgPlanRow, PgPlanStepRow } from '../electric/worky-electric.contract';
import { mapMessage, mapPlan, mapPlanStep, isKnownPlanStepStatus } from '../electric/worky-electric.mapper';

/**
 * Nest-side `ShapeStream` consumer that mirrors the manager's Postgres rows
 * (synced via Electric SQL) into Mongo and re-broadcasts a `WorkyEvent` over
 * the existing SSE channel (`WorkyEventService.emit`).
 *
 * Real contract (reconciled): three whole-table shapes scoped by
 * `session_id` — `messages`, `plans`, `plan_steps` (the board). Every shape
 * request carries `&secret=<ELECTRIC_SECRET>`. `plan_steps` rows update IN
 * PLACE — there is no separate task_results shape/table.
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
    @InjectModel(WorkyMessage.name) private readonly messageModel: Model<WorkyMessageDocument>,
    @InjectModel(WorkyPlanProjection.name) private readonly planProjectionModel: Model<WorkyPlanProjectionDocument>,
    @InjectModel(WorkyElectricCursor.name) private readonly cursorModel: Model<WorkyElectricCursorDocument>,
  ) {
    this.logger.setContext(WorkyElectricConsumerService.name);
  }

  /** Gated payload logging (row/control/applied) — content may be PII. */
  private get debug(): boolean {
    return !!this.config.get<boolean>('worky.electricDebug');
  }

  async onModuleInit(): Promise<void> {
    await this.subscribe(
      'messages',
      this.config.get<string>('worky.electricMessagesTable')!,
      (m) => this.handleMessages(m),
    );
    await this.subscribe(
      'plans',
      this.config.get<string>('worky.electricPlansTable')!,
      (m) => this.handlePlans(m),
    );
    await this.subscribe(
      'plan_steps',
      this.config.get<string>('worky.electricPlanStepsTable')!,
      (m) => this.handlePlanSteps(m),
    );
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
    const secret = this.config.get<string>('worky.electricSecret');
    const url = this.config.get<string>('worky.electricUrl')!;
    this.logger.log('[worky-electric] subscribing', {
      shape,
      table,
      url,
      hasSecret: !!secret,
      resumeHandle: cursor?.handle ?? null,
      resumeOffset: cursor?.offset ?? null,
    });
    const stream = new ShapeStream({
      url,
      // replica:'full' so UPDATE rows carry ALL columns, not just changed ones —
      // our upsert replaces the mapped fields, so partial rows would clobber
      // title/description/lane/status with defaults (e.g. "Step undefined").
      params: { table, replica: 'full', ...(secret ? { secret } : {}) },
      handle: cursor?.handle ?? undefined,
      offset: (cursor?.offset as never) ?? undefined,
    });
    const unsubscribe = stream.subscribe(
      async (messages) => {
        this.logger.log('[worky-electric] batch', { shape, messageCount: messages.length });
        await handler(messages);
        await this.persistCursor(shape, stream.shapeHandle, String(stream.lastOffset));
      },
      (err) => this.logger.error('[worky-electric] stream error', { shape, error: (err as Error).message }),
    );
    this.streams.push({ unsubscribe });
  }

  async persistCursor(shape: string, handle: string | undefined, offset: string): Promise<void> {
    await this.cursorModel
      .updateOne({ shape }, { $set: { handle: handle ?? null, offset } }, { upsert: true })
      .exec();
    this.logger.log('[worky-electric] cursor persisted', { shape, handle: handle ?? null, offset });
  }

  async handleMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'messages', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      try {
        const row = m.value as unknown as PgMessageRow;
        if (this.debug) {
          this.logger.debug('[worky-electric] row', {
            shape: 'messages',
            op: m.headers.operation,
            sid: row.session_id,
            payload: row,
          });
        }
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'messages', sid: row.session_id });
          continue;
        }
        const { set, event } = mapMessage(row, target.streamId);
        await this.messageModel
          .findOneAndUpdate(
            { streamId: target.streamId, externalId: row.id },
            { $set: set },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
        if (this.debug) {
          this.logger.debug('[worky-electric] applied', {
            shape: 'messages',
            streamId: target.streamId,
            ownerUserId: target.ownerUserId,
            externalId: row.id,
            eventType: event.type,
            set,
          });
        }
      } catch (err) {
        this.logger.error('Failed to process message row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlanSteps(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'plan_steps', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      try {
        const row = m.value as unknown as PgPlanStepRow;
        if (this.debug) {
          this.logger.debug('[worky-electric] row', {
            shape: 'plan_steps',
            op: m.headers.operation,
            sid: row.session_id,
            payload: row,
          });
        }
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plan_steps', sid: row.session_id });
          continue;
        }
        if (!isKnownPlanStepStatus(row.status)) {
          this.logger.warn('Unknown plan_step status', { status: row.status, step: row.step_id });
        }
        const { set, event } = mapPlanStep(row, target.streamId);
        await this.taskModel
          .findOneAndUpdate(
            { streamId: target.streamId, externalId: row.step_id },
            { $set: set },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
        if (this.debug) {
          this.logger.debug('[worky-electric] applied', {
            shape: 'plan_steps',
            streamId: target.streamId,
            ownerUserId: target.ownerUserId,
            externalId: row.step_id,
            eventType: event.type,
            set,
          });
        }
      } catch (err) {
        this.logger.error('Failed to process plan_step row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlans(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'plans', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      try {
        const row = m.value as unknown as PgPlanRow;
        if (this.debug) {
          this.logger.debug('[worky-electric] row', {
            shape: 'plans',
            op: m.headers.operation,
            sid: row.session_id,
            payload: row,
          });
        }
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plans', sid: row.session_id });
          continue;
        }
        const { set, event } = mapPlan(row, target.streamId);
        await this.planProjectionModel
          .findOneAndUpdate(
            { streamId: target.streamId },
            { $set: set },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
        if (this.debug) {
          this.logger.debug('[worky-electric] applied', {
            shape: 'plans',
            streamId: target.streamId,
            ownerUserId: target.ownerUserId,
            eventType: event.type,
            set,
          });
        }
      } catch (err) {
        this.logger.error('Failed to process plan row', { error: (err as Error).message });
        continue;
      }
    }
  }
}
