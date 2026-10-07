import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client';
import { LoggerService } from '../../logger';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { WorkyMessageRepository } from '../persistence/worky-message.repository';
import { WorkyMirrorRepository } from '../persistence/worky-mirror.repository';
import {
  PgSessionRow,
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
  mapSession,
  mapPlanStep,
  isKnownPlanStepStatus,
  isTerminalSessionStatus,
  mapMessageComponent,
  mapPlanStepComponent,
  mapPlanStepArtifact,
} from '../electric/worky-electric.mapper';

/**
 * Nest-side `ShapeStream` consumer that mirrors the manager's Postgres rows
 * (synced via Electric SQL) into the `worky` schema and re-broadcasts a
 * `WorkyEvent` over the existing SSE channel (`WorkyEventService.emit`).
 *
 * Real contract (reconciled): three whole-table shapes scoped by
 * `session_id` — `messages`, `plans`, `plan_steps` (the board). Every shape
 * request carries `&secret=<ELECTRIC_SECRET>`. `plan_steps` rows update IN
 * PLACE — there is no separate task_results shape/table.
 *
 * Resume: each shape's Electric `handle`+`offset` is persisted in
 * `worky.electric_cursors` after every processed batch, so a restart resumes
 * the shape log rather than re-streaming from scratch.
 */
@Injectable()
export class WorkyElectricConsumerService implements OnModuleInit, OnModuleDestroy {
  private static readonly MESSAGES_CURSOR_KEY = 'messages:turn-id-v1';
  private static readonly SESSIONS_CURSOR_KEY = 'sessions:v1';
  private static readonly PLANS_CURSOR_KEY = 'plans:v2';
  private static readonly PLAN_STEPS_CURSOR_KEY = 'plan_steps:v2';
  private streams: { unsubscribe: () => void }[] = [];
  private destroyed = false;

  constructor(
    private readonly config: ConfigService,
    private readonly streamService: WorkyStreamService,
    private readonly events: WorkyEventService,
    private readonly logger: LoggerService,
    private readonly tasks: WorkyTaskRepository,
    private readonly messages: WorkyMessageRepository,
    private readonly mirror: WorkyMirrorRepository,
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
      'sessions',
      this.config.get<string>('worky.electricSessionsTable')!,
      (m) => this.handleSessions(m),
      WorkyElectricConsumerService.SESSIONS_CURSOR_KEY,
    );
    await this.subscribe(
      'plans',
      this.config.get<string>('worky.electricPlansTable')!,
      (m) => this.handlePlans(m),
      WorkyElectricConsumerService.PLANS_CURSOR_KEY,
    );
    await this.subscribe(
      'plan_steps',
      this.config.get<string>('worky.electricPlanStepsTable')!,
      (m) => this.handlePlanSteps(m),
      WorkyElectricConsumerService.PLAN_STEPS_CURSOR_KEY,
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
    this.destroyed = true;
    for (const s of this.streams) {
      try {
        s.unsubscribe();
      } catch (error) {
        this.logger.warn('[worky-electric] unsubscribe failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async subscribe(
    shape: string,
    table: string,
    handler: (messages: unknown[]) => Promise<void>,
    cursorKey = shape,
  ): Promise<void> {
    const cursor = await this.mirror.findCursor(cursorKey);
    const secret = this.config.get<string>('worky.electricSecret');
    const url = this.config.get<string>('worky.electricUrl')!;
    this.logger.log('[worky-electric] subscribing', {
      shape,
      cursorKey,
      table,
      url,
      hasSecret: !!secret,
      resumeHandle: cursor?.handle ?? null,
      resumeOffset: cursor?.logOffset ?? null,
    });
    const stream = new ShapeStream({
      url,
      // replica:'full' so UPDATE rows carry ALL columns, not just changed ones —
      // our upsert replaces the mapped fields, so partial rows would clobber
      // title/description/lane/status with defaults (e.g. "Step undefined").
      params: { table, replica: 'full', ...(secret ? { secret } : {}) },
      handle: cursor?.handle ?? undefined,
      offset: (cursor?.logOffset as never) ?? undefined,
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
        await this.processBatch(handler, messages, () =>
          this.persistCursor(cursorKey, stream.shapeHandle, String(stream.lastOffset)),
        );
      },
      (err) => { this.logger.error('[worky-electric] stream error', { shape, error: (err).message }); },
    );
    this.streams.push({ unsubscribe });
  }

  private async processBatch(
    handler: (messages: unknown[]) => Promise<void>,
    messages: unknown[],
    persist: () => Promise<void>,
  ): Promise<void> {
    await handler(messages);
    if (!this.destroyed) await persist();
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
    await this.mirror.saveCursor(shape, handle ?? null, offset);
    this.logger.log('[worky-electric] cursor persisted', { shape, handle: handle ?? null, offset });
  }

  async handleMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (this.destroyed) return;
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'messages', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      await this.retryProjection('messages', async () => {
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
          return;
        }
        const { set, event } = mapMessage(row, target.streamId);
        // An owner row adopts the local copy appendOwnerMessage already stored
        // instead of inserting a duplicate (see WorkyMessageRepository.mirror).
        const stored = await this.messages.mirror(target.streamId, row.id, set);
        // Emit the stored message id, not the manager's row id, so the SSE frame
        // and the REST history agree on identity. The frontend dedupes on that id
        // to drop the copy it already rendered from the POST response.
        this.events.emit(target.ownerUserId, target.streamId, {
          ...event,
          payload: { ...event.payload, id: stored.id },
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
      });
    }
  }

  async handlePlanSteps(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (this.destroyed) return;
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'plan_steps', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      await this.retryProjection('plan_steps', async () => {
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
          return;
        }
        if (!isKnownPlanStepStatus(row.status)) {
          this.logger.warn('Unknown plan_step status', { status: row.status, step: row.step_id });
        }
        const { set, event } = mapPlanStep(row, target.streamId);
        await this.tasks.upsertMirrored(target.streamId, row.step_id, set);
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
      });
    }
  }

  async handleSessions(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (this.destroyed) return;
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'sessions', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      await this.retryProjection('sessions', async () => {
        const row = m.value as unknown as PgSessionRow;
        const target = await this.streamService.findByAiSessionId(row.id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'sessions', sid: row.id });
          return;
        }
        const { set, event } = mapSession(row, target.streamId);
        await this.mirror.upsertProjection(target.streamId, set);
        this.events.emit(target.ownerUserId, target.streamId, event);
        if (isTerminalSessionStatus(row.status)) {
          this.events.emit(target.ownerUserId, target.streamId, {
            type: 'stream.terminal',
            emittedAt: Date.now(),
            payload: { error: row.status.toLowerCase() === 'failed', source: `session-${row.status}` },
          });
        }
        if (this.debug) {
          this.logger.debug('[worky-electric] applied', {
            shape: 'sessions',
            streamId: target.streamId,
            ownerUserId: target.ownerUserId,
            eventType: event.type,
            status: row.status,
          });
        }
      });
    }
  }

  async handlePlans(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (this.destroyed) return;
      if (isControlMessage(m)) {
        if (this.debug) {
          this.logger.debug('[worky-electric] control', { shape: 'plans', headers: m.headers });
        }
        continue;
      }
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      await this.retryProjection('plans', async () => {
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
          return;
        }
        const { set, event } = mapPlan(row, target.streamId);
        await this.mirror.upsertProjection(target.streamId, set);
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
      });
    }
  }

  private async retryProjection(shape: string, operation: () => Promise<void>): Promise<void> {
    let attempt = 0;
    while (!this.destroyed) {
      try {
        await operation();
        return;
      } catch (err) {
        attempt += 1;
        if (attempt === 1 || (attempt & (attempt - 1)) === 0) {
          this.logger.error('[worky-electric] projection failed; retrying before cursor advance', {
            shape,
            attempt,
            error: (err as Error).message,
          });
        }
        await this.waitForProjectionRetry(Math.min(30_000, 1_000 * 2 ** (attempt - 1)));
      }
    }
  }

  private async waitForProjectionRetry(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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
        const { set, event } = mapMessageComponent(row, target.streamId);
        await this.messages.upsertComponent(target.streamId, row.component_id, set);
        this.events.emit(target.ownerUserId, target.streamId, event);
        // An `error` component is only ever attached to a failed turn's message
        // (service._add_error_message), so its arrival means the turn is over.
        // Emit `stream.terminal` here too — this shape is PROVEN to sync (the
        // error card renders), whereas the `sessions` shape may not be published
        // in every deployment. Clears the "working" flag / releases the Stop button.
        if ((row.type || '').toLowerCase() === 'error') {
          this.logger.log('[worky-electric] error component → stream.terminal', {
            sid: row.session_id, streamId: target.streamId });
          this.events.emit(target.ownerUserId, target.streamId, {
            type: 'stream.terminal',
            emittedAt: Date.now(),
            payload: { error: true, source: 'error-component' },
          });
        }
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
        const { set, event } = mapPlanStepComponent(row, target.streamId);
        await this.mirror.upsertStepComponent(target.streamId, row.component_id, set);
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
        const { set, event } = mapPlanStepArtifact(row, target.streamId);
        await this.mirror.upsertStepArtifact(target.streamId, row.artifact_id, set);
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process plan_step_artifact row', { error: (err as Error).message });
        continue;
      }
    }
  }
}
