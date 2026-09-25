import {
  Injectable,
  Logger,
  OnModuleDestroy,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';
import { isObjectId } from '@common/postgres';
import { ConversationV2GrpcClientService } from './conversation-v2.grpc-client.service';
import { ConversationV2EventStoreService } from './conversation-v2-event-store.service';
import { ConversationV2PointerWriterService } from './conversation-v2-pointer-writer.service';
import { ConversationV2NameGeneratorService } from './conversation-v2-name-generator.service';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2SessionAccessService } from './conversation-v2-session-access.service';
import { ConversationV2StreamGatewayService } from './conversation-v2-stream-gateway.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { SandboxRuntimeContext } from '@common/runtime/sandbox-scope';
import { SkillService } from '@modules/skill/skill.service';
import type { IGrpcSkill } from '@modules/skill/interfaces/skill.interface';
import { ConnectorService } from '@modules/connector/connector.service';
import type { IGrpcConnector } from '@modules/connector/interfaces/connector.interface';
import { ModelsService } from '@modules/models/models.service';
import { RuntimeBindingService } from '@modules/app-runtime/services/runtime-binding.service';
import { RuntimeFinalizedRevisionService } from '@modules/app-runtime/services/runtime-finalized-revision.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import type { ConversationV2Event } from '../types/conversation-v2.types';

export interface StartStreamRequest {
  message: string;
  model?: string;
  clientEventId?: string;
  connectorRepo?: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  };
  skillIds?: string[];
  connectorIds?: string[];
  /**
   * Finalized revision the turn must build from (historical-version send).
   * Validated, branched and pinned before the agent turn starts — see
   * {@link ConversationV2StreamService.startStream}.
   */
  baseRevisionId?: string;
}

interface ActiveStream {
  subscription: Subscription;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Owns the background gRPC `Chat` consumption for conversation-v2, fully
 * decoupled from any HTTP request. A turn is kicked off by
 * {@link startStream} (from the `POST .../message` endpoint, fire-and-forget)
 * and runs to completion regardless of whether — or which — SSE pipe the client
 * currently has open. Every event is persisted to the event store AND pushed to
 * the user's pipe(s) via the gateway, tagged with its `sessionId`.
 *
 * This is the v1 `StreamService` pattern adapted to v2's event-log model, and
 * is what allows one user to run several conversations at once: the old design
 * tied the gRPC stream to the per-conversation SSE request, so switching
 * conversations cancelled the stream you left.
 */
@Injectable()
export class ConversationV2StreamService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationV2StreamService.name);

  // userId -> set of sessionIds currently streaming
  private readonly activeStreams = new Map<string, Set<string>>();
  // streamKey (`userId:sessionId`) -> active gRPC subscription + idle timer
  private readonly activeCalls = new Map<string, ActiveStream>();

  constructor(
    private readonly config: ConfigService,
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly pointerWriter: ConversationV2PointerWriterService,
    private readonly nameGenerator: ConversationV2NameGeneratorService,
    private readonly sessions: ConversationV2SessionService,
    private readonly sessionAccess: ConversationV2SessionAccessService,
    private readonly gateway: ConversationV2StreamGatewayService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly skillService: SkillService,
    private readonly connectorService: ConnectorService,
    private readonly modelsService: ModelsService,
    private readonly finalizedRevisions: RuntimeFinalizedRevisionService,
    private readonly runtimeRevisions: RuntimeRevisionService,
    private readonly runtimeBindings: RuntimeBindingService,
  ) {}

  onModuleDestroy(): void {
    for (const [, active] of this.activeCalls) {
      if (active.idleTimer) clearTimeout(active.idleTimer);
      active.subscription.unsubscribe();
    }
    this.activeCalls.clear();
    this.activeStreams.clear();
  }

  /**
   * Kick off a chat turn. Persists the user message, fires title generation on
   * the first message, then subscribes to the gRPC stream in the background.
   * Resolves once the turn has been *registered* (validation + user echo done);
   * the gRPC stream continues after this resolves. Throws synchronously on
   * validation / concurrency failures so the controller can return an error.
   */
  async startStream(
    userId: string,
    sessionId: string,
    req: StartStreamRequest,
  ): Promise<void> {
    const max = this.config.get<number>('conversationV2.maxMessageLength') ?? 30000;
    if (!req.message || req.message.length === 0 || req.message.length > max) {
      throw new BadRequestException(`message must be 1..${max} chars`);
    }

    const resolved = await this.sessionAccess.resolveSession(userId, sessionId);
    if (!resolved) throw new NotFoundException('Session not found');
    const pointer = resolved.pointer;
    const grpcUserId = resolved.ownerId;
    if (!pointer.aiSessionId) throw new BadRequestException('Session not ready');

    const aiSessionId = pointer.aiSessionId;
    const systemWorkspaceId = pointer.systemWorkspaceId ?? null;

    // Concurrency guards, mirroring v1 StreamService.
    const maxStreams = this.config.get<number>('conversationV2.maxConcurrentStreams') ?? 5;
    const userStreams = this.activeStreams.get(userId);
    if (userStreams && userStreams.size >= maxStreams && !userStreams.has(sessionId)) {
      throw new ConflictException({
        code: 'CONVERSATION_STREAM_LIMIT',
        message: `Maximum of ${maxStreams} concurrent conversations reached`,
      });
    }
    if (userStreams?.has(sessionId)) {
      throw new ConflictException({
        code: 'CONVERSATION_ALREADY_STREAMING',
        message: 'This conversation is already responding',
      });
    }

    // One-shot title gen keys off eventCount captured BEFORE the user append.
    const eventCount = (pointer as unknown as { eventCount?: number }).eventCount ?? 0;
    const isFirstMessage = eventCount === 0;

    // Resolve the model actually used by this turn: an explicit per-message
    // model wins; otherwise the conversation-v2 default (admin-configured on an
    // existing model, reusing its config) and then the global default.
    const model = req.model ?? (await this.resolveConversationV2DefaultModel());

    // Historical-version send: validate the selected revision, branch a fresh
    // revision from it and pin the runtime binding, so the agent builds from
    // the user-selected state without rewriting existing history. Runs BEFORE
    // the user echo is persisted so an invalid revision fails the request
    // cleanly with a 400.
    let branchRevisionId: string | null = null;
    if (req.baseRevisionId) {
      await this.finalizedRevisions.assertFinalized(aiSessionId, req.baseRevisionId);
      const branch = await this.runtimeRevisions.branchRevision(aiSessionId, req.baseRevisionId);
      await this.runtimeBindings.updateRevision(aiSessionId, branch.revisionId);
      branchRevisionId = branch.revisionId;
    }

    // Persist + emit the user's prompt before invoking gRPC, so a reloading
    // client sees what was asked. event_id comes from the client when provided
    // so the pipe frame replaces the optimistic echo instead of duplicating it.
    const userEvent = {
      type: 'message',
      payload: {
        event_id: req.clientEventId ?? randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
        role: 'user',
        content: req.message,
        attachments: [],
      },
    } as unknown as ConversationV2Event;

    try {
      const { sequence } = await this.eventStore.append(sessionId, userEvent);
      this.pointerWriter.apply(sessionId, userEvent).catch(() => undefined);
      this.push(userId, sessionId, userEvent, sequence);
    } catch (err) {
      // Surface persistence failure to the caller rather than starting a stream
      // whose user turn was never recorded.
      throw new BadRequestException(
        `Failed to record message: ${(err as Error).message}`,
      );
    }

    // Register as active before subscribing so a racing second POST is rejected.
    if (!this.activeStreams.has(userId)) this.activeStreams.set(userId, new Set());
    this.activeStreams.get(userId)!.add(sessionId);

    if (isFirstMessage) {
      void this.nameGenerator.generate(req.message, model).then((title) => {
        if (!title) return;
        const titleEvent = {
          type: 'title',
          payload: {
            event_id: randomUUID(),
            timestamp: Math.floor(Date.now() / 1000),
            title,
          },
        } as unknown as ConversationV2Event;
        // Route through the same persistence + push path as AI events.
        this.processEvent(userId, sessionId, titleEvent, model, null, {
          done: () => undefined,
        }).catch(() => undefined);
      });
    }

    const skills = req.skillIds?.length
      ? await this.skillService.findByIdsForGrpc(req.skillIds)
      : [];
    // Resolve the selected connectors into gRPC bindings with the current user's
    // auth (token + identity headers) resolved per request, exactly like v1.
    const runtimeContext: SandboxRuntimeContext = {
      userId,
      scopeType: 'conversation',
      scopeId: `conversation:${sessionId}`,
      laneId: 'main',
    };
    const connectors = req.connectorIds?.length
      ? await this.connectorService.findByIdsForGrpc(req.connectorIds, userId, runtimeContext)
      : [];
    // Persist the current selection on the session so it survives a reload
    // (mirrors v1's conversation-level `selectedSkills`). Refreshed every send.
    await this.sessions.setSelectedSkills(sessionId, req.skillIds ?? []);
    await this.sessions.setSelectedConnectors(sessionId, req.connectorIds ?? []);
    this.runGrpc(userId, grpcUserId, sessionId, aiSessionId, systemWorkspaceId, req, model, skills, connectors, branchRevisionId);
  }

  /**
   * Tear down our subscription to a session's stream (does not tell the AI
   * service to stop — that is the controller's `stopSession` → gRPC StopSession,
   * which ends the stream and triggers our `complete` handler naturally).
   */
  stop(userId: string, sessionId: string): void {
    const key = `${userId}:${sessionId}`;
    const active = this.activeCalls.get(key);
    if (!active) return;
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.subscription.unsubscribe();
    this.cleanup(userId, sessionId);
  }

  isStreaming(userId: string, sessionId: string): boolean {
    return !!this.activeStreams.get(userId)?.has(sessionId);
  }

  // ===================== internals =====================

  /**
   * Resolve the conversation-v2 default model identifier (LiteLLM model name)
   * when the client does not send one explicitly: the admin-configured
   * conversation-v2 default (e.g. the OpenCode-provider DeepSeek V4 Flash)
   * wins, then the global admin default, then nothing (the AI service falls
   * back to its own default). Never throws — a lookup failure degrades to the
   * legacy omission behaviour.
   */
  private async resolveConversationV2DefaultModel(): Promise<string | undefined> {
    try {
      const conversationV2Default =
        await this.modelsService.getConversationV2DefaultModel();
      const identifier = this.modelsService.getModelIdentifier(conversationV2Default);
      if (identifier) return identifier;

      const globalDefault = await this.modelsService.getDefaultModel();
      return this.modelsService.getModelIdentifier(globalDefault) || undefined;
    } catch (err) {
      this.logger.warn(
        `Failed to resolve conversation-v2 default model: ${(err as Error).message}`,
      );
      return undefined;
    }
  }


  private runGrpc(
    actorUserId: string,
    grpcUserId: string,
    sessionId: string,
    aiSessionId: string,
    systemWorkspaceId: string | null,
    req: StartStreamRequest,
    model: string | undefined,
    skills: IGrpcSkill[],
    connectors: IGrpcConnector[],
    branchRevisionId: string | null = null,
  ): void {
    const key = `${actorUserId}:${sessionId}`;
    const idleMs = this.config.get<number>('conversationV2.grpcIdleTimeoutMs') ?? 120000;
    // Serialize per-event work so SSE frames are written in emission order and
    // the terminal handlers wait for in-flight appends to drain.
    let pending: Promise<void> = Promise.resolve();
    let terminalEmitted = false;
    let terminalReceived = false;
    let firstAssistantMessageEventId: string | null = null;

    const finish = () => {
      const active = this.activeCalls.get(key);
      if (active?.idleTimer) clearTimeout(active.idleTimer);
      this.cleanup(actorUserId, sessionId);
    };

    const emitTerminalDone = async (): Promise<void> => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      const doneEvent = {
        type: 'done',
        payload: {
          event_id: randomUUID(),
          timestamp: Math.floor(Date.now() / 1000),
        },
      } as unknown as ConversationV2Event;
      let sequence: number | undefined;
      try {
        const r = await this.eventStore.append(sessionId, doneEvent);
        sequence = r.sequence;
        await this.pointerWriter.apply(sessionId, doneEvent).catch(() => undefined);
      } catch {
        /* persistence failed — still push so the client can react */
      }
      this.push(actorUserId, sessionId, doneEvent, sequence);
    };

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
      } as unknown as ConversationV2Event;
      let sequence: number | undefined;
      try {
        const r = await this.eventStore.append(sessionId, errorEvent);
        sequence = r.sequence;
        await this.pointerWriter.apply(sessionId, errorEvent).catch(() => undefined);
      } catch {
        /* persistence failed — still push so the client can react */
      }
      this.push(actorUserId, sessionId, errorEvent, sequence);
    };

    const resetIdle = () => {
      const active = this.activeCalls.get(key);
      if (!active) return;
      if (active.idleTimer) clearTimeout(active.idleTimer);
      active.idleTimer = setTimeout(() => {
        this.logger.error(`Stream idle timeout for session ${sessionId}`);
        void pending.catch(() => undefined).then(async () => {
          await emitTerminalError('Stream timed out');
          finish();
        });
      }, idleMs);
    };

    const isRepoBound = !!req.connectorRepo;
    let gRpcMessage = isRepoBound
      ? `[system] The user has selected the GitHub repository "${
          req.connectorRepo!.repoName
        }" (${req.connectorRepo!.repoUrl ?? req.connectorRepo!.repoId}) for this conversation. Use the GitHub MCP tools scoped to this repository for any repository-level actions (issues, PRs, commits, branches, etc). Do NOT ask the user which repo to use — it has already been selected.\n\n${
          req.message
        }`
      : req.message;
    if (req.baseRevisionId && branchRevisionId) {
      gRpcMessage =
        `[system] The user selected a previous version of the app (revision ${req.baseRevisionId}) and wants to continue working from it. ` +
        `The workspace has been branched to revision ${branchRevisionId}, whose files are exactly the state of that version. ` +
        `Treat revision ${branchRevisionId} as the current state — do NOT assume changes from newer revisions are present.\n\n${gRpcMessage}`;
    }

    const subscription = this.grpcClient
      .chat(grpcUserId, aiSessionId, gRpcMessage, model, req.connectorRepo, skills, connectors)
      .subscribe({
        next: (event) => {
          resetIdle();
          // Pure liveness ping — a slow step (e.g. a tool call) is still in
          // flight upstream. Nothing to persist or push; resetting the idle
          // timer above is the entire point.
          if (event.type === 'heartbeat') return;
          if (event.type === 'done' || event.type === 'error' || event.type === 'wait') {
            terminalReceived = true;
          }
          pending = pending.then(() =>
            this.processEvent(actorUserId, sessionId, event, model, systemWorkspaceId, {
              done: () => undefined,
              setFirstAssistantId: (id) => {
                firstAssistantMessageEventId = id;
              },
              getFirstAssistantId: () => firstAssistantMessageEventId,
            }).catch(async (err) => {
              await emitTerminalError((err as Error).message);
              finish();
            }),
          );
        },
        error: (err: Error) => {
          void pending.catch(() => undefined).then(async () => {
            await emitTerminalError(err.message);
            finish();
          });
        },
        complete: () => {
          void pending.catch(() => undefined).then(async () => {
            if (!terminalReceived) {
              await emitTerminalDone();
            }
            finish();
          });
        },
      });

    this.activeCalls.set(key, { subscription, idleTimer: null });
    resetIdle();
  }

  /**
   * Push an application_component from the app-runtime finalize path when
   * OpenCode does not relay it over gRPC/SSE.
   */
  async publishApplicationComponent(
    userId: string,
    sessionOrWorkspaceId: string,
    payload: {
      event_id: string;
      timestamp: number;
      url: string;
      title?: string;
      ceph_path?: string;
      files_tree?: import('../types/conversation-v2.types').FilesTreeNode | null;
      file_count?: number;
      revision_id?: string;
    },
  ): Promise<void> {
    const sessionId = await this.resolveConversationSessionId(sessionOrWorkspaceId);
    const event = {
      type: 'application_component',
      payload,
    } as unknown as ConversationV2Event;
    const { sequence } = await this.eventStore.append(sessionId, event);
    await this.pointerWriter.apply(sessionId, event).catch(() => undefined);
    this.push(userId, sessionId, event, sequence);
  }

  /**
   * Runtime bindings are keyed by APImanus `aiSessionId` (`workspaceId`).
   * Conversation events are keyed by the YellowStorm pointer id.
   */
  private async resolveConversationSessionId(sessionOrWorkspaceId: string): Promise<string> {
    const byAi = await this.sessions.findByAiSessionId(sessionOrWorkspaceId);
    if (byAi?.id) return byAi.id;
    if (isObjectId(sessionOrWorkspaceId)) {
      const byId = await this.sessions.getById(sessionOrWorkspaceId);
      if (byId?.id) return byId.id;
    }
    throw new NotFoundException(`Invalid session id ${sessionOrWorkspaceId}`);
  }

  /** Persist one event, push to the user's pipe, then run non-critical side effects. */
  private async processEvent(
    userId: string,
    sessionId: string,
    event: ConversationV2Event,
    model: string | undefined,
    systemWorkspaceId: string | null,
    hooks: {
      done: () => void;
      setFirstAssistantId?: (id: string) => void;
      getFirstAssistantId?: () => string | null;
    },
  ): Promise<void> {
    const { sequence } = await this.eventStore.append(sessionId, event);

    // Push immediately after durable append so SSE is not blocked by tagModel
    // or attachment harvest (those used to run before the client saw the event).
    this.pointerWriter.apply(sessionId, event).catch(() => undefined);
    this.push(userId, sessionId, event, sequence);

    const isAssistantMessage =
      event.type === 'message' &&
      (event.payload as { role?: string }).role === 'assistant';

    if (
      model &&
      hooks.getFirstAssistantId &&
      hooks.getFirstAssistantId() === null &&
      isAssistantMessage
    ) {
      const eventId = event.payload.event_id;
      hooks.setFirstAssistantId?.(eventId);
      await this.eventStore.tagModel(sessionId, eventId, model);
    }

    // Harvest AI-emitted attachments into the session's system workspace.
    if (systemWorkspaceId && isAssistantMessage) {
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
  }

  /** Push a persisted event to the user's SSE pipe(s), tagged with sessionId. */
  private push(
    userId: string,
    sessionId: string,
    event: ConversationV2Event,
    sequence?: number,
  ): void {
    const payload = event.payload as unknown as Record<string, unknown>;
    this.gateway.sendToUser(userId, {
      type: event.type,
      data: { sessionId, ...payload, ...(sequence !== undefined ? { sequence } : {}) },
    });
  }

  private cleanup(userId: string, sessionId: string): void {
    this.activeCalls.delete(`${userId}:${sessionId}`);
    const userStreams = this.activeStreams.get(userId);
    if (userStreams) {
      userStreams.delete(sessionId);
      if (userStreams.size === 0) this.activeStreams.delete(userId);
    }
  }
}
