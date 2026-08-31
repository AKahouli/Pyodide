import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { Workspace, WorkspaceDocument } from '../../workspace/schemas/workspace.schema';
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
} from '../interfaces/worky-stream.interface';
import { LoggerService } from '../../logger';
import { NotFoundException, ForbiddenException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { escapeRegex } from '../../../common/utils';
import { WORKY_MANAGER_AGENT_TYPE_SLUG } from '../constants/worky.constants';
import { WorkyAuditEvent } from '../schemas/worky-audit-event.schema';
import { WorkyBudgetReservation } from '../schemas/worky-budget-reservation.schema';
import { WorkyCostEvent } from '../schemas/worky-cost-event.schema';
import { WorkyEphemeralWorker } from '../schemas/worky-ephemeral-worker.schema';
import { WorkyExecutionReport } from '../schemas/worky-execution-report.schema';
import { WorkyExecutionSnapshot } from '../schemas/worky-execution-snapshot.schema';
import { WorkyIdempotencyRecord } from '../schemas/worky-idempotency-record.schema';
import { WorkyInteraction } from '../schemas/worky-interaction.schema';
import { WorkyMailEventLedger } from '../schemas/worky-mail-event-ledger.schema';
import { WorkyMemoryEntry, WorkyMemoryProposal } from '../schemas/worky-memory.schema';
import { WorkyMessage } from '../schemas/worky-message.schema';
import { WorkyPlanDelta } from '../schemas/worky-plan-delta.schema';
import { WorkyPlanVersion } from '../schemas/worky-plan-version.schema';
import { WorkyScheduledEvent } from '../schemas/worky-scheduled-event.schema';
import { WorkyTask } from '../schemas/worky-task.schema';
import { WorkyTaskResult } from '../schemas/worky-task-result.schema';
import { WorkyTrace } from '../schemas/worky-trace.schema';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';

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
    @InjectModel(WorkyStream.name)
    private readonly streamModel: Model<WorkyStreamDocument>,
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    private readonly agentRepository: AgentRepository,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly agentTypeService: AgentTypeService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
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
    // overhead (and the workspace name collided on the unique (createdBy,
    // name) index). `workspaceId` still scopes governance; absent an explicit
    // one we fall back to the owner id — the value previously used.
    const stream = await this.streamModel.create({
      ownerUserId: new Types.ObjectId(userId),
      workspaceId: dto.workspaceId
        ? new Types.ObjectId(dto.workspaceId)
        : new Types.ObjectId(userId),
      // aiSessionId is intentionally omitted here (defaults to null via the
      // schema). The orchestrator session is created lazily on first
      // message send — see `ensureKickoffContext` — so stream creation no
      // longer depends on manager/gRPC availability.
      // Per-stream model selection starts unset; resolved at
      // planning / execution time by `WorkyPlanningService` using
      // the per-turn override → stream field → admin default chain.
      managerModelId: null,
      workerModelId: null,
      title,
      status: 'created',
      controlState: 'active',
      schedulerEnabled: false,
      currentPlanVersion: 0,
      executionPlanVersion: null,
      budget: {
        limitUsd: 0,
        limitTokens: 0,
        spendUsd: 0,
        tokensUsed: 0,
        enforcement: 'hard_stop',
      },
      activeDurationMinutes: 0,
      lastActivityAt: new Date(),
    });

    this.logger.log('Worky stream created', {
      streamId: stream._id.toString(),
      userId,
    });

    return this.toResponse(stream);
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
  ): Promise<{ aiSessionId: string }> {
    const doc = await this.streamModel
      .findById(streamId)
      .lean<{ aiSessionId?: string | null }>()
      .exec();
    if (!doc) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    let aiSessionId = doc.aiSessionId ?? null;
    if (!aiSessionId) {
      aiSessionId = await this.orchestrator.createSession(userId);
      await this.streamModel.updateOne({ _id: streamId }, { $set: { aiSessionId } }).exec();
    }
    return { aiSessionId };
  }

  async findByAiSessionId(
    aiSessionId: string,
  ): Promise<{ streamId: string; ownerUserId: string } | null> {
    const doc = await this.streamModel
      .findOne({ aiSessionId })
      .lean<{ _id: unknown; ownerUserId: unknown }>()
      .exec();
    if (!doc) return null;
    return { streamId: String(doc._id), ownerUserId: String(doc.ownerUserId) };
  }

  async delete(userId: string, streamId: string): Promise<{ ok: true; deletedWorkspaceId: string | null }> {
    const stream = await this.streamModel.findById(streamId).exec();
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }

    const artifactWorkspaceId = stream.artifactWorkspaceId?.toString() ?? null;
    if (artifactWorkspaceId) {
      await this.workspaceDocuments.deleteAllByWorkspace(artifactWorkspaceId);
      await this.workspaceService.delete(artifactWorkspaceId, userId);
    }
    if (stream.managerAgentId) {
      await this.agentRepository.deleteByIdAndOwner(String(stream.managerAgentId), String(stream.ownerUserId));
    }
    await this.deleteStreamScopedRecords(stream._id as Types.ObjectId);
    await this.streamModel.deleteOne({ _id: stream._id }).exec();

    this.logger.log('Worky stream deleted', {
      streamId,
      userId,
      artifactWorkspaceId,
      managerAgentId: stream.managerAgentId?.toString() ?? null,
    });
    return { ok: true, deletedWorkspaceId: artifactWorkspaceId };
  }

  async findAllForUser(
    userId: string,
    query: QueryWorkyStreamsDto,
  ): Promise<IWorkyStreamListResult> {
    const ownerUserId = new Types.ObjectId(userId);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));

    // `baseFilter` scopes to the owner + search + created-date window. It drives
    // `statusCounts` so the home-page tiles/chips show the full breakdown
    // regardless of which status is currently selected.
    const baseFilter: Record<string, unknown> = { ownerUserId };
    if (query.search) {
      baseFilter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    }
    const createdAt: Record<string, Date> = {};
    if (query.createdFrom) createdAt.$gte = new Date(query.createdFrom);
    if (query.createdTo) createdAt.$lte = new Date(query.createdTo);
    if (Object.keys(createdAt).length > 0) baseFilter.createdAt = createdAt;

    // `filter` adds the active status selection — it bounds the paginated data
    // and the total count, but intentionally NOT statusCounts.
    const filter: Record<string, unknown> = { ...baseFilter };
    if (query.status?.length) filter.status = { $in: query.status };

    const sortSpec = this.buildStreamSortSpec(query.sort, query.sortDir);

    const [total, streams, statusAgg] = await Promise.all([
      this.streamModel.countDocuments(filter).exec(),
      this.streamModel
        .find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.streamModel
        .aggregate([{ $match: baseFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
        .exec(),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusAgg as Array<{ _id: string; count: number }>) {
      if (row._id) statusCounts[row._id] = row.count;
    }

    const streamIds = (streams as Array<{ _id: Types.ObjectId }>).map((s) => s._id);
    const laneAgg =
      streamIds.length > 0
        ? ((await this.connection
            .model(WorkyTask.name)
            .aggregate([
              { $match: { streamId: { $in: streamIds } } },
              { $group: { _id: { streamId: '$streamId', lane: '$lane' }, count: { $sum: 1 } } },
            ])
            .exec()) as Array<{ _id: { streamId: Types.ObjectId; lane: string }; count: number }>)
        : [];

    const statsByStream = this.buildStatsByStream(laneAgg);

    const data: IWorkyStreamListItem[] = (streams as unknown[]).map((s) => {
      const item = this.toResponse(s);
      return { ...item, stats: statsByStream.get(item.id) ?? this.emptyStreamStats() };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0, statusCounts },
    };
  }

  private buildStreamSortSpec(
    sort: QueryWorkyStreamsDto['sort'],
    sortDir: QueryWorkyStreamsDto['sortDir'],
  ): Record<string, 1 | -1> {
    const dir: 1 | -1 = sortDir === 'asc' ? 1 : -1;
    switch (sort) {
      case 'created':
        return { createdAt: dir };
      case 'title':
        return { title: dir };
      case 'lastActivity':
      default:
        return { lastActivityAt: dir, createdAt: -1 };
    }
  }

  private emptyStreamStats(): IWorkyStreamStats {
    return { totalTasks: 0, running: 0, done: 0, blocked: 0, failed: 0, progress: 0 };
  }

  private buildStatsByStream(
    laneAgg: Array<{ _id: { streamId: Types.ObjectId; lane: string }; count: number }>,
  ): Map<string, IWorkyStreamStats> {
    const map = new Map<string, IWorkyStreamStats>();
    for (const row of laneAgg) {
      const streamId = row._id.streamId.toString();
      const stats = map.get(streamId) ?? this.emptyStreamStats();
      stats.totalTasks += row.count;
      if (row._id.lane === 'running') stats.running += row.count;
      else if (row._id.lane === 'done') stats.done += row.count;
      else if (row._id.lane === 'blocked') stats.blocked += row.count;
      else if (row._id.lane === 'failed') stats.failed += row.count;
      map.set(streamId, stats);
    }
    for (const stats of map.values()) {
      stats.progress = stats.totalTasks > 0 ? stats.done / stats.totalTasks : 0;
    }
    return map;
  }

  async findById(userId: string, streamId: string): Promise<IWorkyStreamResponse> {
    const stream = await this.streamModel.findById(streamId).lean().exec();
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    return this.toResponse(stream);
  }

  /**
   * Internal lookup used by `WorkyStreamAccessGuard` — does not perform
   * the access check, returns the raw document.
   */
  async findByIdInternal(streamId: string): Promise<WorkyStreamDocument | null> {
    return this.streamModel.findById(streamId).exec();
  }

  async patch(
    userId: string,
    streamId: string,
    dto: UpdateWorkyStreamDto,
  ): Promise<IWorkyStreamResponse> {
    const stream = await this.streamModel.findById(streamId).exec();
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    if (dto.title !== undefined) {
      const next = dto.title.trim();
      if (next !== stream.title) {
        const duplicate = await this.streamModel
          .findOne({ ownerUserId: stream.ownerUserId, title: next, _id: { $ne: stream._id } })
          .lean()
          .exec();
        if (duplicate) {
          throw new ConflictException(
            ErrorCode.CONFLICT,
            'A Worky stream with this title already exists.',
          );
        }
        stream.title = next;
        stream.lastActivityAt = new Date();
      }
    }
    if (dto.managerModelId !== undefined) {
      const next =
        typeof dto.managerModelId === 'string' && dto.managerModelId.trim()
          ? dto.managerModelId.trim()
          : null;
      if (next !== (stream.managerModelId ?? null)) {
        stream.managerModelId = next;
        stream.lastActivityAt = new Date();
      }
    }
    if (dto.workerModelId !== undefined) {
      const next =
        typeof dto.workerModelId === 'string' && dto.workerModelId.trim()
          ? dto.workerModelId.trim()
          : null;
      if (next !== (stream.workerModelId ?? null)) {
        stream.workerModelId = next;
        stream.lastActivityAt = new Date();
      }
    }
    await stream.save();
    return this.toResponse(stream);
  }

  // ===== Private helpers =====

  private async deleteStreamScopedRecords(streamObjectId: Types.ObjectId): Promise<void> {
    const taskDocs = await this.connection
      .model(WorkyTask.name)
      .find({ streamId: streamObjectId })
      .select({ _id: 1 })
      .lean()
      .exec();
    const taskIds = (taskDocs as Array<{ _id: Types.ObjectId }>).map((task) => task._id);
    const deletes: Array<[string, Record<string, unknown>]> = [
      [WorkyAuditEvent.name, { streamId: streamObjectId }],
      [WorkyBudgetReservation.name, { streamId: streamObjectId }],
      [WorkyCostEvent.name, { streamId: streamObjectId }],
      [WorkyEphemeralWorker.name, { streamId: streamObjectId }],
      [WorkyExecutionReport.name, { streamId: streamObjectId }],
      [WorkyExecutionSnapshot.name, { streamId: streamObjectId }],
      [WorkyIdempotencyRecord.name, { streamId: streamObjectId }],
      [WorkyInteraction.name, { streamId: streamObjectId }],
      [WorkyMailEventLedger.name, { streamId: streamObjectId }],
      [WorkyMemoryEntry.name, { sourceStreamId: streamObjectId }],
      [WorkyMemoryProposal.name, { sourceStreamId: streamObjectId }],
      [WorkyMessage.name, { streamId: streamObjectId }],
      [WorkyPlanDelta.name, { streamId: streamObjectId }],
      [WorkyPlanVersion.name, { streamId: streamObjectId }],
      [WorkyScheduledEvent.name, { streamId: streamObjectId }],
      [WorkyTask.name, { streamId: streamObjectId }],
      [WorkyTrace.name, { streamId: streamObjectId }],
    ];
    if (taskIds.length > 0) {
      deletes.push([WorkyTaskResult.name, { taskId: { $in: taskIds } }]);
    }
    const results = await Promise.all(
      deletes.map(async ([name, filter]) => {
        const result = await this.connection.model(name).deleteMany(filter).exec();
        return [name, result.deletedCount ?? 0] as const;
      }),
    );
    this.logger.log('Worky stream scoped records deleted', {
      streamId: streamObjectId.toString(),
      deletedCounts: Object.fromEntries(results),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): IWorkyStreamResponse {
    const id = (doc._id as Types.ObjectId).toString();
    return {
      id,
      ownerUserId: (doc.ownerUserId as Types.ObjectId).toString(),
      workspaceId: (doc.workspaceId as Types.ObjectId).toString(),
      artifactWorkspaceId: doc.artifactWorkspaceId
        ? (doc.artifactWorkspaceId as Types.ObjectId).toString()
        : null,
      managerAgentId: doc.managerAgentId
        ? (doc.managerAgentId as Types.ObjectId).toString()
        : null,
      managerModelId: (doc.managerModelId as string | null | undefined) ?? null,
      workerModelId: (doc.workerModelId as string | null | undefined) ?? null,
      governancePolicyRef: doc.governancePolicyRef
        ? (doc.governancePolicyRef as Types.ObjectId).toString()
        : null,
      title: doc.title as string,
      status: doc.status as string,
      controlState: doc.controlState as string,
      schedulerEnabled: Boolean(doc.schedulerEnabled),
      currentPlanVersion: Number(doc.currentPlanVersion ?? 0),
      executionPlanVersion: doc.executionPlanVersion ?? null,
      budget: {
        limitUsd: Number(doc.budget?.limitUsd ?? 0),
        limitTokens: Number(doc.budget?.limitTokens ?? 0),
        spendUsd: Number(doc.budget?.spendUsd ?? 0),
        tokensUsed: Number(doc.budget?.tokensUsed ?? 0),
        enforcement: (doc.budget?.enforcement as 'hard_stop' | 'notify') ?? 'hard_stop',
      },
      startedAt: this.toIso(doc.startedAt),
      completedAt: this.toIso(doc.completedAt),
      activeDurationMinutes: Number(doc.activeDurationMinutes ?? 0),
      createdAt: this.toIso(doc.createdAt) ?? new Date().toISOString(),
      updatedAt: this.toIso(doc.updatedAt) ?? new Date().toISOString(),
      lastActivityAt: this.toIso(doc.lastActivityAt) ?? new Date().toISOString(),
    };
  }

  private toIso(value: unknown): string | null | undefined {
    if (value === null || value === undefined) return value as null | undefined;
    if (value instanceof Date) return value.toISOString();
    return value as string;
  }
}
