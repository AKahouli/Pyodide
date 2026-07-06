import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { Workspace, WorkspaceDocument } from '../../workspace/schemas/workspace.schema';
import { Agent, AgentDocument } from '../../agent/schemas/agent.schema';
import { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import { CreateWorkyStreamDto } from '../dto/create-worky-stream.dto';
import { UpdateWorkyStreamDto } from '../dto/update-worky-stream.dto';
import { QueryWorkyStreamsDto } from '../dto/query-worky-streams.dto';
import { IWorkyStreamResponse } from '../interfaces/worky-stream.interface';
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
import { ConversationV2GrpcClientService } from '../../conversation-v2/services/conversation-v2.grpc-client.service';

const ARTIFACT_WORKSPACE_NAME_PREFIX = 'Worky';
const STREAM_AGENT_NAME_PREFIX = 'Worky Manager';
const STREAM_AGENT_NAME_MAX = 50;

/**
 * Aggregate lifecycle for Worky streams. Part 1 covers:
 *   - `create`   : provision a dedicated artifact workspace + a per-stream
 *                  Manager agent entity, persist the stream row.
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
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly agentTypeService: AgentTypeService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly grpcClient: ConversationV2GrpcClientService,
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
    const agentType = await this.agentTypeService.findBySlug(WORKY_MANAGER_AGENT_TYPE_SLUG);
    if (!agentType) {
      throw new NotFoundException(
        ErrorCode.AGENT_TYPE_NOT_FOUND,
        'Worky Manager agent type is not seeded.',
      );
    }

    const artifactWorkspace = await this.createArtifactWorkspace(userId, title);
    const managerAgent = await this.createManagerAgent(userId, title, agentType.id);

    const stream = await this.streamModel.create({
      ownerUserId: new Types.ObjectId(userId),
      workspaceId: dto.workspaceId
        ? new Types.ObjectId(dto.workspaceId)
        : artifactWorkspace.createdBy,
      artifactWorkspaceId: artifactWorkspace._id,
      managerAgentId: managerAgent._id,
      // aiSessionId is intentionally omitted here (defaults to null via the
      // schema). The conversation-v2 session is created lazily on first
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
      artifactWorkspaceId: artifactWorkspace._id.toString(),
      managerAgentId: managerAgent._id.toString(),
    });

    return this.toResponse(stream);
  }

  /**
   * Used by `WorkyMessageController` to kick off the manager over gRPC:
   * returns both the conversation-v2 session id and the stream's
   * persistent manager model selection (if any), so the caller can
   * resolve the per-turn override → stream field → admin default chain
   * without a second round-trip.
   *
   * Lazily creates the conversation-v2 session on first use if the stream
   * doesn't have one yet (`aiSessionId: null`) — either because it was
   * created before this design change, or because eager creation was
   * removed from `create()`. This decouples stream creation from manager
   * availability and self-heals pre-existing streams.
   */
  async ensureKickoffContext(
    streamId: string,
    userId: string,
  ): Promise<{ aiSessionId: string; managerModelId: string | null }> {
    const doc = await this.streamModel
      .findById(streamId)
      .lean<{ aiSessionId?: string | null; managerModelId?: string | null }>()
      .exec();
    if (!doc) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    let aiSessionId = doc.aiSessionId ?? null;
    if (!aiSessionId) {
      aiSessionId = await this.grpcClient.createSession(userId, []);
      await this.streamModel.updateOne({ _id: streamId }, { $set: { aiSessionId } }).exec();
    }
    return { aiSessionId, managerModelId: doc.managerModelId ?? null };
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
      await this.agentModel.deleteOne({ _id: stream.managerAgentId, createdBy: stream.ownerUserId }).exec();
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
  ): Promise<IWorkyStreamResponse[]> {
    const filter: Record<string, unknown> = { ownerUserId: new Types.ObjectId(userId) };
    if (query.search) {
      filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    }
    const streams = await this.streamModel
      .find(filter)
      .sort({ lastActivityAt: -1, createdAt: -1 })
      .lean()
      .exec();
    return streams.map((s) => this.toResponse(s));
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

  private async createArtifactWorkspace(
    userId: string,
    streamTitle: string,
  ): Promise<WorkspaceDocument> {
    const allocatedStorage =
      this.config.get<number>('worky.defaultStorageBytes') ?? 52_428_800;
    const baseAlias = this.toAlias(`worky-${streamTitle}`);
    const alias = await this.uniqueAlias(userId, baseAlias);

    const workspace = await this.workspaceModel.create({
      name: `${ARTIFACT_WORKSPACE_NAME_PREFIX}: ${streamTitle}`.slice(0, 100),
      alias,
      storagePrefix: alias,
      description: `Dedicated Worky artifact workspace for "${streamTitle}".`,
      createdBy: new Types.ObjectId(userId),
      documentCount: 0,
      usedStorage: 0,
      allocatedStorage,
      isSystem: false,
      isPersonal: false,
    });

    this.logger.log('Worky artifact workspace created', {
      workspaceId: workspace._id.toString(),
      alias,
      userId,
    });
    return workspace;
  }

  private async createManagerAgent(
    userId: string,
    streamTitle: string,
    agentTypeId: string,
  ): Promise<AgentDocument> {
    const baseName = `${STREAM_AGENT_NAME_PREFIX} — ${streamTitle}`.slice(0, STREAM_AGENT_NAME_MAX);
    const name = await this.uniqueAgentName(userId, baseName);

    const agent = await this.agentModel.create({
      name,
      slug: this.toSlug(`${name}-${Date.now()}`),
      agentType: new Types.ObjectId(agentTypeId),
      role: 'Worky Manager Agent — orchestrates the stream, plans tasks, and dispatches ephemeral workers.',
      description: 'Per-stream Manager. Created automatically when the Worky stream is created.',
      temperature: 0,
      llmModel: '',
      instruction: '',
      ignorePrePrompt: false,
      knowledgeBases: [],
      tools: [],
      skills: [],
      disabledSkills: [],
      connectors: [],
      connectorActionSelections: [],
      isDefault: false,
      isDefaultForType: false,
      isActive: true,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Worky Manager agent created', {
      agentId: agent._id.toString(),
      userId,
    });
    return agent;
  }

  private async uniqueAlias(userId: string, baseAlias: string): Promise<string> {
    let alias = baseAlias;
    let counter = 1;
    while (counter < 100) {
      const existing = await this.workspaceModel
        .findOne({ createdBy: new Types.ObjectId(userId), alias })
        .lean()
        .exec();
      if (!existing) return alias;
      alias = `${baseAlias}-${counter}`;
      counter++;
    }
    return `${baseAlias}-${Date.now()}`;
  }

  private async uniqueAgentName(userId: string, baseName: string): Promise<string> {
    let name = baseName;
    let counter = 1;
    while (counter < 100) {
      const existing = await this.agentModel
        .findOne({ name, createdBy: new Types.ObjectId(userId) })
        .lean()
        .exec();
      if (!existing) return name;
      name = `${baseName} (${counter})`.slice(0, STREAM_AGENT_NAME_MAX);
      counter++;
    }
    return `${baseName}-${Date.now()}`.slice(0, STREAM_AGENT_NAME_MAX);
  }

  private toAlias(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
  }

  private toSlug(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): IWorkyStreamResponse {
    const id = (doc._id as Types.ObjectId).toString();
    return {
      id,
      ownerUserId: (doc.ownerUserId as Types.ObjectId).toString(),
      workspaceId: (doc.workspaceId as Types.ObjectId).toString(),
      artifactWorkspaceId: (doc.artifactWorkspaceId as Types.ObjectId).toString(),
      managerAgentId: (doc.managerAgentId as Types.ObjectId).toString(),
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
