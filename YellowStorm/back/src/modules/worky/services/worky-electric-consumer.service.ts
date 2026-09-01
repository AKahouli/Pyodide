import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client';
import { LoggerService } from '../../logger';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyMessage, WorkyMessageDocument } from '../schemas/worky-message.schema';
import { WorkyPlanProjection, WorkyPlanProjectionDocument } from '../schemas/worky-plan-projection.schema';
import { WorkyElectricCursor, WorkyElectricCursorDocument } from '../schemas/worky-electric-cursor.schema';
import { WorkyMessageComponent, WorkyMessageComponentDocument } from '../schemas/worky-message-component.schema';
import { WorkyPlanStepComponent, WorkyPlanStepComponentDocument } from '../schemas/worky-plan-step-component.schema';
import { WorkyPlanStepArtifact, WorkyPlanStepArtifactDocument } from '../schemas/worky-plan-step-artifact.schema';
import {
  PgMessageRow,
  PgPlanRow,
  PgPlanStepRow,
  PgMessageComponentRow,
  PgPlanStepComponentRow,
  PgPlanStepArtifactRow,
} from '../electric/worky-electric.contract';
import {
  mapMessage,
  mapPlan,
  mapPlanStep,
  isKnownPlanStepStatus,
  mapMessageComponent,
  mapPlanStepComponent,
  mapPlanStepArtifact,
} from '../electric/worky-electric.mapper';

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
  private static readonly MESSAGES_CURSOR_KEY = 'messages:turn-id-v1';
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
    @InjectModel(WorkyMessageComponent.name) private readonly messageComponentModel: Model<WorkyMessageComponentDocument>,
    @InjectModel(WorkyPlanStepComponent.name) private readonly planStepComponentModel: Model<WorkyPlanStepComponentDocument>,
    @InjectModel(WorkyPlanStepArtifact.name) private readonly planStepArtifactModel: Model<WorkyPlanStepArtifactDocument>,
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
      WorkyElectricConsumerService.MESSAGES_CURSOR_KEY,
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
    await this.subscribe(
      'message_components',
      this.config.get<string>('worky.electricMessageComponentsTable')!,
      (m) => this.handleMessageComponents(m),
    );
    await this.subscribe(
      'plan_step_components',
      this.config.get<string>('worky.electricPlanStepComponentsTable')!,
      (m) => this.handlePlanStepComponents(m),
    );
    await this.subscribe(
      'plan_step_artifacts',
      this.config.get<string>('worky.electricPlanStepArtifactsTable')!,
      (m) => this.handlePlanStepArtifacts(m),
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
    cursorKey = shape,
  ): Promise<void> {
    const cursor = await this.cursorModel
      .findOne({ shape: cursorKey })
      .lean<{ handle?: string | null; offset?: string | null }>()
      .exec();
    const secret = this.config.get<string>('worky.electricSecret');
    const url = this.config.get<string>('worky.electricUrl')!;
    this.logger.log('[worky-electric] subscribing', {
      shape,
      cursorKey,
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
      // Without an onError handler, non-retryable errors (4xx) are THROWN and
      // escape as an unhandled rejection that crashes the whole backend. The
      // most common one: a shape whose Postgres table doesn't exist yet (the
      // manager-owned message_components / plan_step_* tables). Handle it, log,
      // and return void to stop just that shape — the app boots and every other
      // shape keeps syncing. (5xx/network/429 are auto-retried before this runs.)
      onError: (err) => {
        this.onShapeError(shape, table, err);
        return undefined;
      },
    });
    const unsubscribe = stream.subscribe(
      async (messages) => {
        this.logger.log('[worky-electric] batch', { shape, messageCount: messages.length });
        await handler(messages);
        await this.persistCursor(cursorKey, stream.shapeHandle, String(stream.lastOffset));
      },
      (err) => this.logger.error('[worky-electric] stream error', { shape, error: (err as Error).message }),
    );
    this.streams.push({ unsubscribe });
  }

  /**
   * Non-retryable shape error handler. A missing table (the manager hasn't
   * created message_components / plan_step_* yet) is expected during rollout, so
   * it's logged as a warning; anything else is a genuine error. Either way the
   * caller returns void to ShapeStream, stopping just this shape rather than
   * throwing and crashing the process.
   */
  onShapeError(shape: string, table: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(message)) {
      this.logger.warn('[worky-electric] shape table missing — skipping until it is created', {
        shape,
        table,
        error: message,
      });
    } else {
      this.logger.error('[worky-electric] shape stopped on a non-retryable error', {
        shape,
        table,
        error: message,
      });
    }
  }

  async persistCursor(shape: string, handle: string | undefined, offset: string): Promise<void> {
    await this.cursorModel
      .updateOne({ shape }, { $set: { handle: handle ?? null, offset } }, { upsert: true })
      .exec();
    this.logger.log('[worky-electric] cursor persisted', { shape, handle: handle ?? null, offset });
  }

  /**
   * The manager sends session/stream ids as strings, but our Mongo schemas type
   * `streamId` as ObjectId and every read query (board, messages) matches an
   * ObjectId. A raw string stored via upsert never matched, so the UI showed
   * nothing. Store a real ObjectId. Falls back to the raw string for
   * non-ObjectId ids (e.g. unit-test fixtures like 'stream-1').
   */
  private toStreamOid(streamId: string): Types.ObjectId | string {
    return Types.ObjectId.isValid(streamId) ? new Types.ObjectId(streamId) : streamId;
  }

  /**
   * Mirror one manager `messages` row into Mongo and return the stored doc.
   *
   * The manager echoes the owner's own message back through Electric, but
   * `appendOwnerMessage` already persisted that message locally with no
   * `externalId`. Inserting the mirrored row as a fresh document would leave
   * two copies of the same message in the history (and hand the UI two
   * different ids for it), so an owner row first adopts the most recent
   * un-mirrored local copy with the same content, stamping it with the
   * Postgres id. Replays then match that `externalId` and update in place.
   */
  private async mirrorMessage(
    streamOid: Types.ObjectId | string,
    row: PgMessageRow,
    set: Record<string, unknown>,
  ): Promise<WorkyMessageDocument | null> {
    const $set = { ...set, streamId: streamOid };
    if (set.role === 'owner') {
      const adopted = await this.messageModel
        .findOneAndUpdate(
          { streamId: streamOid, role: 'owner', content: row.content, externalId: null },
          { $set },
          { new: true, sort: { createdAt: -1 } },
        )
        .exec();
      if (adopted) return adopted;
    }
    return this.messageModel
      .findOneAndUpdate(
        { streamId: streamOid, externalId: row.id },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
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
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapMessage(row, target.streamId);
        const doc = await this.mirrorMessage(streamOid, row, set);
        // Emit the Mongo id, not the Postgres row id, so the SSE frame and the
        // REST history agree on identity. The frontend dedupes on that id to
        // drop the copy it already rendered from the POST response.
        this.events.emit(target.ownerUserId, target.streamId, {
          ...event,
          payload: { ...event.payload, id: String(doc?._id ?? row.id) },
        });
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
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlanStep(row, target.streamId);
        await this.taskModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.step_id },
            { $set: { ...set, streamId: streamOid } },
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
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlan(row, target.streamId);
        await this.planProjectionModel
          .findOneAndUpdate(
            { streamId: streamOid },
            { $set: { ...set, streamId: streamOid } },
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

  async handleMessageComponents(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgMessageComponentRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'message_components', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapMessageComponent(row, target.streamId);
        await this.messageComponentModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.component_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process message_component row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlanStepComponents(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgPlanStepComponentRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plan_step_components', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlanStepComponent(row, target.streamId);
        await this.planStepComponentModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.component_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process plan_step_component row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlanStepArtifacts(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgPlanStepArtifactRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plan_step_artifacts', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlanStepArtifact(row, target.streamId);
        await this.planStepArtifactModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.artifact_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process plan_step_artifact row', { error: (err as Error).message });
        continue;
      }
    }
  }
}
