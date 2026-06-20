import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Subject, Observable } from 'rxjs';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyMessage, WorkyMessageDocument } from '../schemas/worky-message.schema';
import { WorkyInteraction, WorkyInteractionDocument } from '../schemas/worky-interaction.schema';
import { LoggerService } from '../../logger';
import { BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyRuntimeClient } from './worky-runtime.client';
import { WorkyEventService } from './worky-event.service';
import { WorkyTaskService } from './worky-task.service';
import { ModelsService } from '../../models/models.service';
import { CreateWorkyMessageDto } from '../dto/create-worky-message.dto';

export interface StartTurnInput {
  streamId: string;
  userId: string;
  content: string;
  triggerKind: 'owner_message' | 'clarification_response' | 'approval_granted' | 'approval_rejected';
  // Optional id of the clarification interaction this turn is
  // resolving. When present, the planning service injects the
  // original question/options into the context snapshot so the
  // Manager can finalize the plan instead of re-asking.
  resolvingInteractionId?: string | null;
  // Per-turn model overrides. The backend resolves the full chain
  // (override → stream field → admin default) and forwards the
  // resolved LiteLLM identifier to the runtime.
  managerModelIdOverride?: string | null;
  workerModelIdOverride?: string | null;
}

export interface ContextSnapshot {
  streamId: string;
  planVersion: number;
  budget: { limitUsd: number; spendUsd: number };
  board: Record<string, unknown[]>;
  ownerMemoryRef: string | null;
  streamMemoryRef: string | null;
  latestMessageId: string | null;
  previousClarification: {
    interactionId: string;
    question: string;
    options: string[];
  } | null;
}

/**
 * Conversational planning — owner ↔ Manager. Part 2 covers:
 *   - `appendOwnerMessage` : persist the `WorkyMessage` (role=owner),
 *     emit `message.appended`, return the saved doc.
 *   - `startTurn`          : build the context snapshot, POST to the
 *     runtime `/runtime/streams/{id}/planning-turn`, parse the runtime
 *     SSE stream, and translate each named frame into a `WorkyEvent`
 *     pushed via `WorkyEventService.emit`.
 *   - `listMessages`       : history endpoint.
 *
 * The runtime client returns a raw SSE body; the parser is intentionally
 * permissive (any line that doesn't parse becomes a `stream.updated`
 * `note` frame, never an error) so a future runtime that adds new frames
 * does not break the contract.
 */
@Injectable()
export class WorkyPlanningService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyMessage.name)
    private readonly messages: Model<WorkyMessageDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteractionDocument>,
    private readonly tasks: WorkyTaskService,
    private readonly runtime: WorkyRuntimeClient,
    private readonly events: WorkyEventService,
    private readonly models: ModelsService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyPlanningService.name);
  }

  async appendOwnerMessage(
    userId: string,
    streamId: string,
    dto: CreateWorkyMessageDto,
  ): Promise<{ id: string; content: string; createdAt: string }> {
    const stream = await this.loadStream(streamId, userId);
    if (!this.isPreExecutionPhase(stream.status)) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        `Messages can only be sent in a pre-execution phase (current: ${stream.status}).`,
      );
    }
    const message = await this.messages.create({
      streamId: stream._id,
      role: 'owner',
      content: dto.content,
      planDeltaRef: null,
      emittedAt: new Date(),
    });
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: {
        id: (message._id as Types.ObjectId).toString(),
        role: 'owner',
        content: dto.content,
      },
    });
    return {
      id: (message._id as Types.ObjectId).toString(),
      content: dto.content,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async listMessages(
    userId: string,
    streamId: string,
    limit = 200,
  ): Promise<Array<{ id: string; role: string; content: string; planDeltaRef: string | null; createdAt: string }>> {
    await this.loadStream(streamId, userId);
    const docs = await this.messages
      .find({ streamId: new Types.ObjectId(streamId) })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((m) => ({
      id: (m._id as Types.ObjectId).toString(),
      role: m.role as string,
      content: m.content as string,
      planDeltaRef: m.planDeltaRef ? (m.planDeltaRef as Types.ObjectId).toString() : null,
      createdAt: (m.createdAt as Date).toISOString(),
    }));
  }

  /**
   * Start one bounded planning turn. The runtime SSE is consumed and
   * each frame is pushed to `WorkyEventService` so the existing
   * `/worky/streams/{id}/events` channel fans out to the browser.
   *
   * The returned `Observable<{frame: RuntimePlanningFrame}>` is the
   * authoritative source for the controller — it includes the terminal
   * `planning.done` (or `planning.error`) so the controller can decide
   * how to close its own stream.
   */
  startTurn(input: StartTurnInput): Observable<{ frame: RuntimePlanningFrame }> {
    const subject = new Subject<{ frame: RuntimePlanningFrame }>();
    void this.runTurn(input, subject);
    return subject.asObservable();
  }

  private async runTurn(
    input: StartTurnInput,
    subject: Subject<{ frame: RuntimePlanningFrame }>,
  ): Promise<void> {
    try {
      const stream = await this.loadStream(input.streamId, input.userId);
      const previousClarification = input.resolvingInteractionId
        ? await this.loadResolvingClarification(input.resolvingInteractionId, stream._id)
        : null;
      const snapshot = await this.buildContextSnapshot(
        stream,
        input.userId,
        previousClarification,
      );
      const { managerModelId, workerModelId } = await this.resolveTurnModelIds(
        stream,
        input.managerModelIdOverride,
        input.workerModelIdOverride,
      );
      const response = await fetch(`${this.runtime.baseURL}/runtime/streams/${input.streamId}/planning-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_message:
            input.triggerKind === 'clarification_response'
              ? `Resolving clarification: ${input.content}`
              : input.content,
          context_snapshot: snapshot,
          manager_model_id: managerModelId,
          worker_model_id: workerModelId,
        }),
        signal: AbortSignal.timeout(this.runtimeTimeoutMs()),
      });
      if (!response.ok || !response.body) {
        const errFrame: RuntimePlanningFrame = {
          type: 'planning.error',
          emitted_at: Date.now() / 1000,
          payload: { error: `Runtime returned ${response.status}` },
        };
        subject.next({ frame: errFrame });
        this.events.emit(input.userId, input.streamId, {
          type: 'stream.terminal',
          emittedAt: Date.now(),
          payload: { error: true, source: 'runtime-non-ok', errorText: `Runtime returned ${response.status}` },
        });
        subject.complete();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // SSE state machine — a "frame" ends with a blank line.
      let eventName: string | null = null;
      let dataLines: string[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') {
            // Frame boundary
            if (dataLines.length === 0 && !eventName) continue;
            const frame = this.parseFrame(eventName, dataLines);
            eventName = null;
            dataLines = [];
            if (!frame) continue;
            subject.next({ frame });
            this.emitRuntimeFrame(input, frame);
            if (frame.type === 'planning.done' || frame.type === 'planning.error') {
              subject.complete();
              return;
            }
            continue;
          }
          if (line.startsWith(':')) continue; // SSE comment
          if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
        }
      }
      // End of body without an explicit terminal — emit a `planning.done`
      // so subscribers always see a terminal frame. Also fan out the
      // terminal to the per-(user, stream) SSE channel so the
      // frontend's "Manager is working…" chip clears; the `stream.updated`
      // we previously sent here was a no-op for the UI.
      const implicitFrame: RuntimePlanningFrame = {
        type: 'planning.done',
        emitted_at: Date.now() / 1000,
        payload: { implicit: true },
      };
      subject.next({ frame: implicitFrame });
      this.events.emit(input.userId, input.streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: { error: false, source: 'runtime-frame-implicit-done' },
      });
      subject.complete();
    } catch (err) {
      const errFrame: RuntimePlanningFrame = {
        type: 'planning.error',
        emitted_at: Date.now() / 1000,
        payload: { error: (err as Error).message },
      };
      this.logger.error('Worky planning turn failed', { error: (err as Error).message });
      subject.next({ frame: errFrame });
      this.events.emit(input.userId, input.streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: { error: true, source: 'turn-exception', errorText: (err as Error).message.slice(0, 500) },
      });
      subject.complete();
    }
  }

  private parseFrame(eventName: string | null, dataLines: string[]): RuntimePlanningFrame | null {
    const data = dataLines.join('\n');
    let payload: Record<string, unknown> = {};
    try {
      payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    } catch {
      payload = { raw: data };
    }
    const innerPayload = (payload.payload as Record<string, unknown> | undefined) ?? payload;
    const type =
      (payload.type as string | undefined) ??
      (eventName ?? 'planning.unknown');
    const emittedAt =
      (payload.emitted_at as number | undefined) ?? Date.now() / 1000;
    return { type, emitted_at: emittedAt, payload: innerPayload };
  }

  private emitRuntimeFrame(input: StartTurnInput, frame: RuntimePlanningFrame): void {
    if (frame.type === 'planning.ack') {
      this.events.emit(input.userId, input.streamId, {
        type: 'stream.updated',
        emittedAt: Date.now(),
        payload: { note: 'planning-ack' },
      });
      return;
    }
    if (frame.type === 'planning.token') {
      this.events.emit(input.userId, input.streamId, {
        type: 'assistant_token',
        emittedAt: Date.now(),
        payload: { text: frame.payload.text ?? '' },
      });
      return;
    }
    if (frame.type === 'planning.delta.applied') {
      this.events.emit(input.userId, input.streamId, {
        type: 'plan.delta.applied',
        emittedAt: Date.now(),
        payload: frame.payload,
      });
      this.events.emit(input.userId, input.streamId, {
        type: 'plan.version.created',
        emittedAt: Date.now(),
        payload: { planVersion: (frame.payload as { resultPlanVersion?: number }).resultPlanVersion ?? null },
      });
      this.events.emit(input.userId, input.streamId, {
        type: 'task.updated',
        emittedAt: Date.now(),
        payload: { reason: 'plan-delta-applied' },
      });
      return;
    }
    if (frame.type === 'planning.done') {
      this.events.emit(input.userId, input.streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: { error: false, source: 'runtime-frame-done' },
      });
      return;
    }
    if (frame.type === 'planning.error') {
      // Surface the runtime's own error message in the terminal payload
      // so the UI can show "why" instead of a generic "stream closed"
      // banner. Truncate to keep the toast bounded. Preserve the
      // runtime's structured `error` field (string) without letting it
      // shadow our `error: true` flag.
      const rawError = (frame.payload as { error?: unknown }).error;
      const errorText =
        typeof rawError === 'string' && rawError.trim()
          ? rawError.slice(0, 500)
          : null;
      const { error: _runtimeError, ...rest } = frame.payload;
      void _runtimeError;
      this.events.emit(input.userId, input.streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: { error: true, source: 'runtime-frame', errorText, ...rest },
      });
    }
  }

  private async resolveTurnModelIds(
    stream: WorkyStreamDocument,
    managerOverride: string | null | undefined,
    workerOverride: string | null | undefined,
  ): Promise<{ managerModelId: string | null; workerModelId: string | null }> {
    // Resolve Manager / worker model ids with the priority chain:
    //   1. per-turn override (passed by the prompt bar),
    //   2. stream's persistent field (set via PATCH /streams/:id),
    //   3. admin default model (ModelsService.getDefaultModel).
    // Any of the three layers may be unset (null); we keep walking
    // the chain until we find a value. The `defaultModel` is fetched
    // only if at least one of the two ids is still unresolved, to
    // avoid an admin DB round-trip in the common case where both
    // fields are set on the stream.
    let managerModelId: string | null = null;
    let workerModelId: string | null = null;
    if (typeof managerOverride === 'string' && managerOverride.trim()) {
      managerModelId = managerOverride.trim();
    } else if (managerOverride === null) {
      // Explicit `null` override = "clear and fall back to stream field"
      // (stream field is also checked below).
      managerModelId = null;
    } else if (stream.managerModelId) {
      managerModelId = stream.managerModelId;
    }
    if (typeof workerOverride === 'string' && workerOverride.trim()) {
      workerModelId = workerOverride.trim();
    } else if (workerOverride === null) {
      workerModelId = null;
    } else if (stream.workerModelId) {
      workerModelId = stream.workerModelId;
    }
    if (!managerModelId || !workerModelId) {
      const defaultModel = await this.models.getDefaultModel();
      const defaultIdentifier = this.models.getModelIdentifier(defaultModel);
      if (!managerModelId) managerModelId = defaultIdentifier || null;
      if (!workerModelId) workerModelId = defaultIdentifier || null;
    }
    if (!managerModelId || !workerModelId) {
      // Reject the turn: the runtime would just hit a missing-model
      // error. Better to surface a clear message at the API boundary.
      this.logger.warn('Worky turn rejected: no model configured', {
        streamId: (stream._id as Types.ObjectId).toString(),
        managerResolved: Boolean(managerModelId),
        workerResolved: Boolean(workerModelId),
      });
      throw new BadRequestException(
        ErrorCode.WORKY_NO_DEFAULT_MODEL,
        'No model is configured for this Worky turn. Select a model in the prompt bar or set a default in Admin > Models.',
      );
    }
    return { managerModelId, workerModelId };
  }

  private async loadStream(streamId: string, userId: string): Promise<WorkyStreamDocument> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const stream = await this.streams.findById(streamId).exec();
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId.toString() !== userId) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    return stream;
  }

  /**
   * Load the clarification interaction a follow-up turn is resolving.
   * The original question/options are injected into the runtime
   * context snapshot so the Manager can produce a `submit_plan_delta`
   * on the next turn instead of looping back to `request_input`.
   * Returns `null` when the interaction is missing, belongs to a
   * different stream, or is not a clarification — those cases are
   * treated as "no prior clarification" so the turn still runs.
   */
  private async loadResolvingClarification(
    interactionId: string,
    streamObjectId: Types.ObjectId,
  ): Promise<{
    interactionId: string;
    question: string;
    options: string[];
  } | null> {
    if (!Types.ObjectId.isValid(interactionId)) return null;
    const interaction = await this.interactions
      .findById(interactionId)
      .lean()
      .exec();
    if (!interaction) return null;
    if (interaction.streamId.toString() !== streamObjectId.toString()) return null;
    if (
      interaction.type !== 'clarification' &&
      interaction.type !== 'assignment_disambiguation'
    ) {
      return null;
    }
    return {
      interactionId: (interaction._id as Types.ObjectId).toString(),
      question: interaction.question,
      options: Array.isArray(interaction.options) ? interaction.options : [],
    };
  }

  private isPreExecutionPhase(status: string): boolean {
    // `start_validation_failed` is a pre-execution status: the owner
    // hit Start Stream before the plan was ready and validation
    // produced no runnable tasks. They must be able to keep
    // conversing with the Manager to fix the plan, otherwise the
    // stream is dead-ended and the owner has to abandon it.
    return (
      status === 'created' ||
      status === 'planning' ||
      status === 'start_validation_failed'
    );
  }

  private async buildContextSnapshot(
    stream: WorkyStreamDocument,
    _userId: string,
    previousClarification?: {
      interactionId: string;
      question: string;
      options: string[];
    } | null,
  ): Promise<ContextSnapshot> {
    const streamId = (stream._id as Types.ObjectId).toString();
    // The board snapshot uses the same projection as `GET /board` so the
    // runtime sees what the owner sees.
    const board = await this.tasks.projectForBoard(streamId, new Map());
    return {
      streamId,
      planVersion: stream.currentPlanVersion,
      budget: {
        limitUsd: stream.budget?.limitUsd ?? 0,
        spendUsd: stream.budget?.spendUsd ?? 0,
      },
      board: board as unknown as Record<string, unknown[]>,
      ownerMemoryRef: null,
      streamMemoryRef: null,
      latestMessageId: null,
      previousClarification: previousClarification ?? null,
    };
  }

  private runtimeTimeoutMs(): number {
    return this.config.get<number>('worky.runtimeTimeoutMs') ?? 120000;
  }
}

export interface RuntimePlanningFrame {
  type: string;
  emitted_at: number;
  payload: Record<string, unknown>;
}
