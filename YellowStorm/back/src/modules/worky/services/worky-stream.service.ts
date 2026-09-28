import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentRepository } from '../../agent/repositories/agent.repository';
import { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import { CreateWorkyStreamDto } from '../dto/create-worky-stream.dto';
import { UpdateWorkyStreamDto } from '../dto/update-worky-stream.dto';
import { QueryWorkyStreamsDto } from '../dto/query-worky-streams.dto';
import {
  IWorkyStreamResponse,
  IWorkyStreamListItem,
  IWorkyStreamListResult,
  IWorkyStreamStats,
  IWorkyStreamShareResponse,
} from '../interfaces/worky-stream.interface';
import { LoggerService } from '../../logger';
import { NotFoundException, ForbiddenException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WORKY_MANAGER_AGENT_TYPE_SLUG } from '../constants/worky.constants';
import { WorkyStreamRepository, type WorkyStreamPatch } from '../persistence/worky-stream.repository';
import type { WorkyStreamRecord, WorkyStreamShareRecord } from '../worky.types';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { USER_LOOKUP_PORT, UserLookupPort } from '@common/ports/user-lookup.port';
import { canWriteWorkyStream, getWorkyStreamAccess } from '../worky-stream-access';
import { WorkyEventService } from './worky-event.service';

/**
 * Aggregate lifecycle for Worky streams. Part 1 covers:
 *   - `create`   : persist the stream row (no per-stream workspace or agent).
 *   - `findAllForUser` / `findById` / `findByIdInternal` : list + read paths.
 *   - `patch`    : PATCH /worky/streams/{id} title-only.
 * Lifecycle transitions (start/pause/resume/stop) and the planning/execution
 * services are out of Part 1 scope (Parts 2/3). They will live in
 * `worky-planning.service.ts` and `worky-execution.service.ts`.
 */
@Injectable()
export class WorkyStreamService implements OnModuleInit {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly agentRepository: AgentRepository,
    private readonly agentTypeService: AgentTypeService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    @Inject(USER_LOOKUP_PORT)
    private readonly users: UserLookupPort = null!,
    private readonly events: WorkyEventService = null!,
  ) {
    this.logger.setContext(WorkyStreamService.name);
  }

  /**
   * Idempotent seed: makes sure the `manager` agent type exists before any
   * stream is created. Runs once on module init.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.agentTypeService.findOrCreateBySlug(WORKY_MANAGER_AGENT_TYPE_SLUG, {
        name: 'Manager',
        defaultPrompt: '',
        isActive: true,
      });
      this.logger.log('Worky Manager agent type ensured', {
        slug: WORKY_MANAGER_AGENT_TYPE_SLUG,
      });
    } catch (error) {
      this.logger.error('Failed to ensure Worky Manager agent type', {
        message: (error as Error).message,
      });
    }
  }

  async create(userId: string, dto: CreateWorkyStreamDto): Promise<IWorkyStreamResponse> {
    const title = dto.title.trim();
    // Worky streams no longer provision a per-stream artifact workspace or a
    // Manager agent: artifacts are unused, and planner/executor/ephemeral
    // agents are resolved by agent *type* at turn time, so both were pure
    // overhead. `workspaceId` still scopes governance; absent an explicit
    // one we fall back to the owner id — the value previously used.
    // aiSessionId and the per-stream model selection start unset: the
    // orchestrator session is created lazily on first message send (see
    // `ensureKickoffContext`), and models are resolved at planning /
    // execution time (per-turn override → stream field → admin default).
    const stream = await this.streams.create({
      ownerUserId: userId,
      workspaceId: dto.workspaceId || userId,
      title,
    });

    this.logger.log('Worky stream created', {
      streamId: stream.id,
      userId,
    });

    return this.toResponse(stream, userId);
  }

  /**
   * Used by `WorkyMessageController` to kick off the manager over gRPC:
   * returns the orchestrator session id for the stream. The planner/executor
   * agents themselves are resolved separately (by agent type) at turn time.
   *
   * Lazily creates the orchestrator session on first use if the stream
   * doesn't have one yet (`aiSessionId: null`) — either because it was
   * created before this design change, or because eager creation was
   * removed from `create()`. This decouples stream creation from manager
   * availability and self-heals pre-existing streams.
   */
  async ensureKickoffContext(
    streamId: string,
    userId: string,
  ): Promise<{ aiSessionId: string; ownerUserId: string }> {
    const context = await this.getRuntimeContext(streamId, userId);
    let aiSessionId = context.aiSessionId;
    if (!aiSessionId) {
      aiSessionId = await this.orchestrator.createSession(context.ownerUserId);
      await this.streams.update(streamId, { aiSessionId });
    }
    return { aiSessionId, ownerUserId: context.ownerUserId };
  }

  async getRuntimeContext(
    streamId: string,
    userId: string,
  ): Promise<{ aiSessionId: string | null; ownerUserId: string }> {
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    if (!canWriteWorkyStream(stream, userId)) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have write access to this Worky stream.',
      );
    }
    return {
      aiSessionId: stream.aiSessionId,
      ownerUserId: stream.ownerUserId,
    };
  }

  async findByAiSessionId(
    aiSessionId: string,
  ): Promise<{ streamId: string; ownerUserId: string } | null> {
    const stream = await this.streams.findByAiSessionId(aiSessionId);
    if (!stream) return null;
    return { streamId: stream.id, ownerUserId: stream.ownerUserId };
  }

  async delete(userId: string, streamId: string): Promise<{ ok: true; deletedWorkspaceId: string | null }> {
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }

    const artifactWorkspaceId = stream.artifactWorkspaceId;
    if (artifactWorkspaceId) {
      await this.workspaceDocuments.deleteAllByWorkspace(artifactWorkspaceId);
      await this.workspaceService.delete(artifactWorkspaceId, userId);
    }
    if (stream.managerAgentId) {
      await this.agentRepository.deleteByIdAndOwner(stream.managerAgentId, stream.ownerUserId);
    }
    // The foreign keys take every stream-scoped row with it; audit rows go inside the same call.
    await this.streams.delete(stream.id);

    this.logger.log('Worky stream deleted', {
      streamId,
      userId,
      artifactWorkspaceId,
      managerAgentId: stream.managerAgentId,
    });
    return { ok: true, deletedWorkspaceId: artifactWorkspaceId };
  }

  async findAllForUser(
    userId: string,
    query: QueryWorkyStreamsDto,
  ): Promise<IWorkyStreamListResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));

    // `statusCounts` and `attentionCount` cover the owner + search + created-date
    // scope only, so the home-page tiles/chips show the full breakdown regardless
    // of which status is currently selected.
    const result = await this.streams.listForUser(userId, {
      search: query.search,
      createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
      createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
      statuses: query.status,
      attention: query.attention,
      sort: query.sort,
      sortDir: query.sortDir,
      page,
      limit,
    });

    const data: IWorkyStreamListItem[] = result.items.map((stream) => ({
      ...this.toResponse(stream, userId),
      stats: this.toStreamStats(result.laneCounts.get(stream.id)),
    }));

    return {
      data,
      meta: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit) || 0,
        statusCounts: result.statusCounts,
        attentionCount: result.attentionCount,
      },
    };
  }

  private toStreamStats(laneCounts: Record<string, number> | undefined): IWorkyStreamStats {
    const stats: IWorkyStreamStats = { totalTasks: 0, running: 0, done: 0, blocked: 0, failed: 0, progress: 0 };
    for (const [lane, count] of Object.entries(laneCounts ?? {})) {
      stats.totalTasks += count;
      if (lane === 'running') stats.running += count;
      else if (lane === 'done') stats.done += count;
      else if (lane === 'blocked') stats.blocked += count;
      else if (lane === 'failed') stats.failed += count;
    }
    stats.progress = stats.totalTasks > 0 ? stats.done / stats.totalTasks : 0;
    return stats;
  }

  async findById(userId: string, streamId: string): Promise<IWorkyStreamResponse> {
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (!getWorkyStreamAccess(stream, userId)) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    return this.toResponse(stream, userId);
  }

  /**
   * Internal lookup used by `WorkyStreamAccessGuard` — does not perform
   * the access check, returns the raw record.
   */
  async findByIdInternal(streamId: string): Promise<WorkyStreamRecord | null> {
    return this.streams.findById(streamId);
  }

  async patch(
    userId: string,
    streamId: string,
    dto: UpdateWorkyStreamDto,
  ): Promise<IWorkyStreamResponse> {
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (!canWriteWorkyStream(stream, userId)) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    const patch: WorkyStreamPatch = {};
    if (dto.title !== undefined) {
      const next = dto.title.trim();
      if (next !== stream.title) {
        if (await this.streams.titleTaken(stream.ownerUserId, next, stream.id)) {
          throw new ConflictException(
            ErrorCode.CONFLICT,
            'A Worky stream with this title already exists.',
          );
        }
        patch.title = next;
      }
    }
    if (dto.managerModelId !== undefined) {
      const next = this.normalizeModelId(dto.managerModelId);
      if (next !== stream.managerModelId) patch.managerModelId = next;
    }
    if (dto.workerModelId !== undefined) {
      const next = this.normalizeModelId(dto.workerModelId);
      if (next !== stream.workerModelId) patch.workerModelId = next;
    }
    if (Object.keys(patch).length === 0) return this.toResponse(stream, userId);

    const updated = await this.streams.update(stream.id, { ...patch, lastActivityAt: new Date() });
    if (!updated) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    return this.toResponse(updated, userId);
  }

  async listShares(userId: string, streamId: string): Promise<IWorkyStreamShareResponse[]> {
    const stream = await this.findOwnedStream(userId, streamId);
    const users = await this.users.byIds(stream.shares.map((share) => share.userId));
    return stream.shares.flatMap((share) => {
      const sharedUser = users.get(share.userId);
      return sharedUser ? [this.toShareResponse(share, sharedUser)] : [];
    });
  }

  async createShare(
    userId: string,
    streamId: string,
    email: string,
    permission: 'read' | 'write',
  ): Promise<IWorkyStreamShareResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const [stream, usersByEmail] = await Promise.all([
      this.findOwnedStream(userId, streamId),
      this.users.byEmails([normalizedEmail]),
    ]);
    const sharedUser = usersByEmail.get(normalizedEmail);
    if (!sharedUser) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_SHARE_USER_NOT_FOUND, 'User not found.');
    }
    if (sharedUser.id === userId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'The stream owner already has access.');
    }
    // Sharing again with the same user changes the permission they already have.
    const share = await this.streams.upsertShare(stream.id, sharedUser.id, permission);
    return this.toShareResponse(share, sharedUser);
  }

  async updateShare(
    userId: string,
    streamId: string,
    shareId: string,
    permission: 'read' | 'write',
  ): Promise<IWorkyStreamShareResponse> {
    const stream = await this.findOwnedStream(userId, streamId);
    const share = await this.streams.updateSharePermission(stream.id, shareId, permission);
    if (!share) throw this.shareNotFound();
    const sharedUser = await this.users.byId(share.userId);
    if (!sharedUser) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_SHARE_USER_NOT_FOUND, 'User not found.');
    }
    return this.toShareResponse(share, sharedUser);
  }

  async revokeShare(userId: string, streamId: string, shareId: string): Promise<void> {
    const stream = await this.findOwnedStream(userId, streamId);
    const revoked = await this.streams.deleteShare(stream.id, shareId);
    if (!revoked) throw this.shareNotFound();
    this.events?.disconnectUserFromStream(revoked.userId, streamId);
  }

  // ===== Private helpers =====

  private async findOwnedStream(userId: string, streamId: string): Promise<WorkyStreamRecord> {
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    if (stream.ownerUserId !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'Only the stream owner can manage sharing.',
      );
    }
    return stream;
  }

  private shareNotFound(): NotFoundException {
    return new NotFoundException(
      ErrorCode.WORKY_STREAM_SHARE_NOT_FOUND,
      'Worky stream share not found.',
    );
  }

  private normalizeModelId(value: string | null): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toShareResponse(
    share: WorkyStreamShareRecord,
    user: { id: string; email: string; firstName: string; lastName: string },
  ): IWorkyStreamShareResponse {
    return {
      id: share.id,
      permission: share.permission,
      user,
      createdAt: share.createdAt.toISOString(),
    };
  }

  private toResponse(stream: WorkyStreamRecord, userId: string): IWorkyStreamResponse {
    const access = getWorkyStreamAccess(stream, userId);
    if (!access) {
      throw new ForbiddenException(ErrorCode.WORKY_STREAM_FORBIDDEN, 'Access denied.');
    }
    return {
      id: stream.id,
      ownerUserId: stream.ownerUserId,
      access,
      workspaceId: stream.workspaceId,
      artifactWorkspaceId: stream.artifactWorkspaceId,
      managerAgentId: stream.managerAgentId,
      managerModelId: stream.managerModelId,
      workerModelId: stream.workerModelId,
      governancePolicyRef: stream.governancePolicyRef,
      title: stream.title,
      status: stream.status,
      controlState: stream.controlState,
      schedulerEnabled: stream.schedulerEnabled,
      currentPlanVersion: stream.currentPlanVersion,
      executionPlanVersion: stream.executionPlanVersion,
      budget: { ...stream.budget },
      startedAt: stream.startedAt?.toISOString() ?? null,
      completedAt: stream.completedAt?.toISOString() ?? null,
      activeDurationMinutes: stream.activeDurationMinutes,
      createdAt: stream.createdAt.toISOString(),
      updatedAt: stream.updatedAt.toISOString(),
      lastActivityAt: stream.lastActivityAt.toISOString(),
    };
  }
}
