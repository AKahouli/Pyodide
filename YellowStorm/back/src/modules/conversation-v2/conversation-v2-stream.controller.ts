import {
  BadRequestException,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { interval, Subject, Subscription, takeUntil } from 'rxjs';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { StreamAuth } from '@modules/conversation/decorators/stream-auth.decorator';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2PointerWriterService } from './services/conversation-v2-pointer-writer.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2EventStoreService } from './services/conversation-v2-event-store.service';
import { ConversationV2NameGeneratorService } from './services/conversation-v2-name-generator.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { SendMessageQueryDto } from './dto/send-message.dto';
import { eventToSseFrame } from './utils/event-mapper';
import type { ConversationV2Event as ConversationV2EventType } from './types/conversation-v2.types';

export interface SseAuthUser {
  id: string;
  [key: string]: unknown;
}

export const CurrentSseUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SseAuthUser => {
    const req = ctx.switchToHttp().getRequest<{ sseUser?: SseAuthUser }>();
    return req.sseUser as SseAuthUser;
  },
);

@ApiTags('conversation-v2')
@ApiBearerAuth()
@Controller('conversation-v2')
export class ConversationV2StreamController {
  constructor(
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly config: ConfigService,
    private readonly pointerWriter: ConversationV2PointerWriterService,
    private readonly sessions: ConversationV2SessionService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly nameGenerator: ConversationV2NameGeneratorService,
  ) {}

  @Get('sessions/:id/stream')
  @Public()
  @StreamAuth()
  async stream(
    @CurrentSseUser() user: SseAuthUser,
    @Param('id') sessionId: string,
    @Query() query: SendMessageQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const max = this.config.get<number>('conversationV2.maxMessageLength') ?? 16384;

    if (!query.message || query.message.length === 0 || query.message.length > max) {
      throw new BadRequestException(`message must be 1..${max} chars`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
    // Disable Nagle's algorithm on the underlying socket so each SSE write is
    // sent immediately rather than coalesced with the next one.
    (res.socket as { setNoDelay?: (b: boolean) => void } | null)?.setNoDelay?.(true);

    const sseWrite = (chunk: string): void => this.sseWrite(res, chunk);

    // SSE warmup padding. Short responses (e.g. a single assistant message)
    // can otherwise sit in Node/Express internal buffers until res.end() —
    // the total bytes don't trip whatever flush threshold is upstream. A 2 KB
    // comment line pushes the buffer past that threshold immediately, so
    // every subsequent small write flushes on its own.
    sseWrite(':' + ' '.repeat(2048) + '\n\n');

    const disconnect$ = new Subject<void>();
    const heartbeatMs = this.config.get<number>('conversationV2.sseHeartbeatMs') ?? 15000;
    const heartbeat = interval(heartbeatMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(() => sseWrite(': heartbeat\n\n'));

    let chatSub: Subscription | null = null;

    // Resolve the pointer once. We need its _id-hex (passed to gRPC = aiSessionId,
    // and used as the sessionId for event store calls) and its systemWorkspaceId
    // for the AI artifact harvester. createForUser is gone — doc-first creation
    // guarantees the pointer exists by the time /stream is hit.
    const pointer = await this.sessions.getOne(user.id, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');
    if (!pointer.aiSessionId) throw new BadRequestException('Session not ready');

    const aiSessionId = pointer.aiSessionId;
    const systemWorkspaceId =
      (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
        .systemWorkspaceId?.toString() ?? null;

    // One-shot: gen only fires on the very first message of the session.
    // We key off eventCount (===0 before any event is appended) rather than
    // pointer.title so a second /stream that arrives while the first
    // generation is still in flight — title still empty in DB — can't
    // trigger a second pass. Captured BEFORE the user event append below.
    const eventCount = (pointer as unknown as { eventCount?: number }).eventCount ?? 0;
    const isFirstMessage = eventCount === 0;

    // Persist + emit the user's prompt as a `message` event BEFORE invoking
    // gRPC. The AI service does not echo user messages on the wire, so
    // without this the event log would only contain assistant turns and a
    // reloading client wouldn't see what the user asked.
    //
    // The event_id comes from the client when provided so the SSE frame can
    // replace the frontend's optimistic echo rather than appearing as a
    // duplicate. Falls back to a server-generated UUID for legacy clients.
    const userEvent = {
      type: 'message',
      payload: {
        event_id: query.clientEventId ?? randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
        role: 'user',
        content: query.message,
        attachments: [],
      },
    } as never;
    try {
      const { sequence: userSeq } = await this.eventStore.append(sessionId, userEvent);
      this.pointerWriter.apply(sessionId, userEvent).catch(() => undefined);
      sseWrite(eventToSseFrame(userEvent, userSeq));
    } catch {
      // If we can't persist the user message we still fall through and let
      // the gRPC chat run; the AI service will produce assistant events that
      // hint at what was asked. Don't kill the stream here.
    }

    return new Promise<void>((resolve) => {
      const finish = () => {
        heartbeat.unsubscribe();
        chatSub?.unsubscribe();
        disconnect$.next();
        disconnect$.complete();
        const r = res as Response & { writableEnded?: boolean };
        if (!r.writableEnded) res.end();
        resolve();
      };

      res.on('close', finish);

      let firstAssistantMessageEventId: string | null = null;
      let terminalEmitted = false;

      // Persist a synthetic terminal `error` event and flip the pointer status,
      // then emit the SSE frame. Used when the gRPC stream errors out (timeout,
      // AI service crash) or when our own append/pipeline throws — without
      // this, the session pointer stays at `active` and a reloading client
      // would re-open the live tail and spin forever.
      const emitTerminalError = async (message: string): Promise<void> => {
        if (terminalEmitted) return;
        terminalEmitted = true;
        const errorEvent = {
          type: 'error',
          payload: {
            event_id: randomUUID(),
            timestamp: Math.floor(Date.now() / 1000),
            error: message,
          },
        } as never;
        let sequence: number | undefined;
        try {
          const r = await this.eventStore.append(sessionId, errorEvent);
          sequence = r.sequence;
          await this.pointerWriter.apply(sessionId, errorEvent).catch(() => undefined);
        } catch {
          // Persistence failed (e.g., pointer deleted). Still emit the SSE
          // frame so the client gets a chance to react — but it'll have no
          // sequence and won't survive a reload.
        }
        try {
          sseWrite(eventToSseFrame(errorEvent, sequence));
        } catch {
          /* response already closed */
        }
      };

      // Serialize per-event work through a single promise chain so that:
      //   1. SSE frames are written in the same order the AI emits them
      //      (independent awaits on append could otherwise interleave).
      //   2. The `complete` callback can wait for all in-flight writes to
      //      drain before tearing down. Without this, RxJS fires complete
      //      synchronously as soon as the gRPC stream ends — for fast
      //      responses the per-event awaits are still in flight, and the
      //      res.write that comes after them lands on an already-ended
      //      response, so the bytes never reach the client.
      let pending: Promise<void> = Promise.resolve();

      const processEvent = async (
        event: ConversationV2EventType,
      ): Promise<void> => {
        try {
          const { sequence } = await this.eventStore.append(sessionId, event);

          if (
            query.model &&
            firstAssistantMessageEventId === null &&
            event.type === 'message' &&
            (event.payload as { role?: string }).role === 'assistant'
          ) {
            firstAssistantMessageEventId = event.payload.event_id;
            await this.eventStore.tagModel(
              sessionId,
              event.payload.event_id,
              query.model,
            );
          }

          this.pointerWriter
            .apply(sessionId, event)
            .catch(() => undefined);

          // Harvest AI-emitted attachments into the session's system workspace.
          // Fire-and-forget: never fails the SSE write. AI's no-dup contract
          // means we don't dedupe.
          if (
            systemWorkspaceId &&
            event.type === 'message' &&
            (event.payload as { role?: string }).role === 'assistant'
          ) {
            const attachments = (event.payload as { attachments?: unknown[] }).attachments;
            if (Array.isArray(attachments)) {
              for (const fileInfo of attachments as Array<{
                id: string;
                name: string;
                content_type: string;
                path: string;
              }>) {
                this.workspaceDocuments
                  .createFromAiArtifact(systemWorkspaceId, fileInfo)
                  .catch(() => undefined);
              }
            }
          }

          sseWrite(eventToSseFrame(event, sequence));
        } catch (err) {
          await emitTerminalError((err as Error).message);
          finish();
        }
      };

      // Fire-and-forget title generation on the first message. The resolved
      // title is pushed through the same `pending` chain as AI events so it
      // gets persisted, updates the pointer, and lands as an SSE frame. If the
      // chat completes before generation returns, the title still gets
      // persisted and a reconnect/reload will pick it up.
      if (isFirstMessage) {
        void this.nameGenerator.generate(query.message, query.model).then((title) => {
          if (!title) return;
          const titleEvent = {
            type: 'title',
            payload: {
              event_id: randomUUID(),
              timestamp: Math.floor(Date.now() / 1000),
              title,
            },
          } as never;
          pending = pending.then(() => processEvent(titleEvent));
        });
      }

      chatSub = this.grpcClient
        .chat(user.id, aiSessionId, query.message, query.model)
        .subscribe({
          next: (event) => {
            pending = pending.then(() => processEvent(event));
          },
          error: async (err: Error) => {
            // Wait for any in-flight writes to complete so the client sees
            // events up to the point of failure before the error frame.
            await pending.catch(() => undefined);
            await emitTerminalError(err.message);
            finish();
          },
          complete: () => {
            // Drain the queue before tearing down — see the comment on
            // `pending` above.
            void pending.catch(() => undefined).then(finish);
          },
        });
    });
  }

  @Get('sessions/:id/stream/live')
  @Public()
  @StreamAuth()
  async streamLive(
    @CurrentSseUser() user: SseAuthUser,
    @Param('id') sessionId: string,
    @Query('since') sinceRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pointer = await this.sessions.getOne(user.id, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');
    // streamLive doesn't make gRPC calls, so aiSessionId isn't required.

    const since = Math.max(0, Number.parseInt(sinceRaw ?? '0', 10) || 0);
    const terminal: ReadonlyArray<string> = ['completed', 'stopped', 'error'];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();
    (res.socket as { setNoDelay?: (b: boolean) => void } | null)?.setNoDelay?.(true);

    const sseWrite = (chunk: string): void => this.sseWrite(res, chunk);

    // SSE warmup padding — same rationale as in `stream`. See the comment there.
    sseWrite(':' + ' '.repeat(2048) + '\n\n');

    const disconnect$ = new Subject<void>();
    const heartbeatMs = this.config.get<number>('conversationV2.sseHeartbeatMs') ?? 15000;
    const pollMs = this.config.get<number>('conversationV2.liveTailPollMs') ?? 1000;
    const heartbeat = interval(heartbeatMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(() => sseWrite(': heartbeat\n\n'));

    let lastSeen = since;
    const poll = interval(pollMs)
      .pipe(takeUntil(disconnect$))
      .subscribe(async () => {
        try {
          const rows = await this.eventStore.listSince(sessionId, lastSeen, 500);
          for (const row of rows) {
            const wire = {
              type: row.type,
              payload: {
                event_id: row.eventId,
                timestamp: row.emittedAt,
                ...(row.payload as Record<string, unknown>),
              },
            } as never;
            sseWrite(eventToSseFrame(wire, row.sequence));
            lastSeen = row.sequence;
          }
          const pointer = await this.sessions.getOne(user.id, sessionId);
          const sessionGone = pointer === null;
          const sessionTerminal = !!pointer && terminal.includes(pointer.status as string);
          if (sessionGone || sessionTerminal) {
            (res as Response & { __teardown?: () => void }).__teardown?.();
          }
        } catch {
          /* swallow — next poll retries */
        }
      });

    return new Promise<void>((resolve) => {
      let settled = false;
      const teardown = () => {
        if (settled) return;
        settled = true;
        heartbeat.unsubscribe();
        poll.unsubscribe();
        disconnect$.next();
        disconnect$.complete();
        const r = res as Response & { writableEnded?: boolean };
        if (!r.writableEnded) res.end();
        resolve();
      };
      // Make teardown reachable from the poll closure.
      (res as Response & { __teardown?: () => void }).__teardown = teardown;
      res.on('close', teardown);
    });
  }

  /**
   * Write a chunk to an SSE response and force a flush. `res.flush` is added
   * by the `compression` middleware — calling it is a no-op when compression
   * is skipping this response (it filters out text/event-stream) but a safety
   * belt if a future middleware change reintroduces buffering on this path.
   */
  private sseWrite(res: Response, chunk: string): void {
    res.write(chunk);
    (res as Response & { flush?: () => void }).flush?.();
  }
}
