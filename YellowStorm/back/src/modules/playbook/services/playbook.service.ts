import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  ExecutionStatus,
} from '../schemas/playbook-execution.schema';
import { CreatePlaybookDto } from '../dto/create-playbook.dto';
import { UpdatePlaybookDto } from '../dto/update-playbook.dto';
import { UpsertPlaybookScheduleDto } from '../dto/upsert-playbook-schedule.dto';
import { PlaybookQueryDto } from '../dto/playbook-query.dto';
import { ExecutionQueryDto } from '../dto/execution-query.dto';
import {
  PlaybookResponse,
  PlaybookSummaryResponse,
  PaginatedPlaybookSummaries,
  PlaybookExecutionResponse,
  PlaybookExecutionSummaryResponse,
  PaginatedExecutions,
  PlaybookDesignMessageResponse,
  ExecutionScheduleData,
} from '../interfaces/playbook.interface';
import { mapExecutionScheduleToData } from '../utils/execution-schedule.mapper';
import { buildExecutionScheduleDocument } from '../utils/execution-schedule-upsert.builder';
import {
  PlaybookDesignMessage,
  PlaybookDesignMessageDocument,
} from '../schemas/playbook-design-message.schema';
import { LoggerService } from '../../logger';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { escapeRegex } from '../../../common/utils';
import { PlaybookReplayService } from './playbook-replay.service';
import { PlaybookOutputFormatService } from './playbook-output-format.service';

@Injectable()
export class PlaybookService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(PlaybookDesignMessage.name)
    private readonly designMessageModel: Model<PlaybookDesignMessageDocument>,
    private readonly logger: LoggerService,
    private readonly replayService: PlaybookReplayService,
    private readonly outputFormatService: PlaybookOutputFormatService,
  ) {
    this.logger.setContext('PlaybookService');
  }

  async create(userId: string, dto: CreatePlaybookDto): Promise<PlaybookResponse> {
    const playbook = await this.playbookModel.create({
      name: dto.name,
      description: dto.description || '',
      tasks: [],
      edges: [],
      workspaces: (dto.workspaces || []).map((id) => new Types.ObjectId(id)),
      createdBy: new Types.ObjectId(userId),
      isActive: true,
    });

    this.logger.log('Playbook created', { playbookId: playbook._id, userId });
    return await this.mapToResponse(playbook);
  }

  async createWithTasksAndEdges(
    userId: string,
    name: string,
    description: string,
    tasks: any[],
    edges: any[],
    workspaceIds: string[],
  ): Promise<PlaybookResponse> {
    const playbook = await this.playbookModel.create({
      name,
      description: description || '',
      tasks,
      edges,
      workspaces: workspaceIds.map((id) => new Types.ObjectId(id)),
      createdBy: new Types.ObjectId(userId),
      isActive: true,
    });

    this.logger.log('Playbook created with tasks', {
      playbookId: playbook._id,
      userId,
      taskCount: tasks.length,
      edgeCount: edges.length,
    });
    return await this.mapToResponse(playbook);
  }

  async cloneForUser(
    sourcePlaybookId: string,
    targetUserId: string,
    options?: { nameSuffix?: string },
  ): Promise<PlaybookResponse> {
    const source = await this.playbookModel.findById(sourcePlaybookId).lean().exec();
    if (!source) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND, 'Playbook not found');
    }

    const cloned = await this.playbookModel.create({
      name: `${source.name}${options?.nameSuffix ?? ' (shared)'}`,
      description: source.description || '',
      tasks: source.tasks || [],
      edges: source.edges || [],
      workspaces: source.workspaces || [],
      createdBy: new Types.ObjectId(targetUserId),
      isActive: true,
    });

    await this.cloneExecutionsForPlaybook(sourcePlaybookId, cloned._id.toString(), targetUserId);

    this.logger.log('Playbook cloned', {
      sourceId: sourcePlaybookId,
      clonedId: cloned._id,
      targetUserId,
    });
    return await this.mapToResponse(cloned);
  }

  async findById(playbookId: string): Promise<PlaybookResponse> {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }
    return await this.mapToResponse(playbook as any);
  }

  async findAllByUser(userId: string, params: PlaybookQueryDto): Promise<PaginatedPlaybookSummaries> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      minTasks,
      maxTasks,
      dateField,
      dateFrom,
      dateTo,
    } = params;
    const skip = (page - 1) * limit;

    const matchQuery: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
      isActive: true,
    };

    if (search) {
      matchQuery.name = { $regex: escapeRegex(search), $options: 'i' };
    }

    // Date filters on native playbook fields
    if (dateField && (dateField === 'createdAt' || dateField === 'updatedAt') && (dateFrom || dateTo)) {
      const dateRange: Record<string, Date> = {};
      if (dateFrom) dateRange.$gte = new Date(dateFrom);
      if (dateTo) dateRange.$lte = new Date(dateTo);
      matchQuery[dateField] = dateRange;
    }

    const needsExecutionLookup =
      sortBy === 'lastExecutionAt' || dateField === 'lastExecutionAt';

    // Build aggregation pipeline
    const pipeline: any[] = [{ $match: matchQuery }];

    // Compute taskCount early so we can filter/sort on it
    pipeline.push({
      $addFields: { taskCount: { $size: { $ifNull: ['$tasks', []] } } },
    });

    // Filter by task count
    if (minTasks !== undefined || maxTasks !== undefined) {
      const taskFilter: Record<string, number> = {};
      if (minTasks !== undefined) taskFilter.$gte = minTasks;
      if (maxTasks !== undefined) taskFilter.$lte = maxTasks;
      pipeline.push({ $match: { taskCount: taskFilter } });
    }

    // Lookup last execution date when needed
    if (needsExecutionLookup) {
      pipeline.push(
        {
          $lookup: {
            from: 'playbook_executions',
            let: { pid: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$playbookId', '$$pid'] } } },
              { $sort: { startedAt: -1 } },
              { $limit: 1 },
              { $project: { startedAt: 1 } },
            ],
            as: '_lastExec',
          },
        },
        {
          $addFields: {
            lastExecutionAt: {
              $ifNull: [{ $arrayElemAt: ['$_lastExec.startedAt', 0] }, null],
            },
          },
        },
        { $project: { _lastExec: 0 } },
      );

      // Date filter on lastExecutionAt
      if (dateField === 'lastExecutionAt' && (dateFrom || dateTo)) {
        const dateRange: Record<string, Date | null> = {};
        if (dateFrom) dateRange.$gte = new Date(dateFrom);
        if (dateTo) dateRange.$lte = new Date(dateTo);
        pipeline.push({ $match: { lastExecutionAt: dateRange } });
      }
    }

    // Count before pagination (use $facet to avoid running pipeline twice)
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: { isFavorite: -1, [sortBy]: sortOrder === 'asc' ? 1 : -1 } as Record<string, 1 | -1> },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              name: 1,
              description: 1,
              taskCount: 1,
              isFavorite: 1,
              lastExecutionAt: 1,
              createdAt: 1,
              updatedAt: 1,
              scheduleEnabled: {
                $eq: [{ $ifNull: ['$executionSchedule.enabled', false] }, true],
              },
            },
          },
        ],
      },
    });

    const [result] = await this.playbookModel.aggregate(pipeline);
    const total = result.metadata[0]?.total ?? 0;
    const playbooks = result.data as any[];

    return {
      playbooks: playbooks.map((p) => this.mapToSummaryResponse(p)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(playbookId: string, dto: UpdatePlaybookDto): Promise<PlaybookResponse> {
    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.tasks !== undefined) updateData.tasks = dto.tasks;
    if (dto.edges !== undefined) updateData.edges = dto.edges;
    if (dto.workspaces !== undefined) updateData.workspaces = dto.workspaces.map((id) => new Types.ObjectId(id));

    const playbook = await this.playbookModel
      .findByIdAndUpdate(playbookId, { $set: updateData }, { new: true })
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    return await this.mapToResponse(playbook as any);
  }

  /**
   * Returns the mapped execution schedule for API consumers (at most one embedded `executionSchedule` per playbook).
   */
  async getSchedule(playbookId: string): Promise<ExecutionScheduleData | null> {
    const playbook = await this.playbookModel.findById(playbookId).select('executionSchedule').lean().exec();
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }
    return mapExecutionScheduleToData(playbook.executionSchedule);
  }

  /** Persists the single embedded schedule for this playbook (replaces any previous configuration). */
  async upsertSchedule(playbookId: string, dto: UpsertPlaybookScheduleDto): Promise<PlaybookResponse> {
    const existing = await this.playbookModel.findById(playbookId).select('executionSchedule').lean().exec();
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }
    const prev = existing.executionSchedule as { lastScheduledRunAt?: Date } | null | undefined;
    const preserveLast =
      dto.enabled && prev?.lastScheduledRunAt ? new Date(prev.lastScheduledRunAt) : null;

    const executionSchedule = buildExecutionScheduleDocument(dto, preserveLast);

    const playbook = await this.playbookModel
      .findByIdAndUpdate(playbookId, { $set: { executionSchedule } }, { new: true })
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    this.logger.log('Playbook schedule upserted', { playbookId, enabled: dto.enabled, type: dto.type });
    return await this.mapToResponse(playbook as any);
  }

  async clearSchedule(playbookId: string): Promise<PlaybookResponse> {
    const disabledSchedule = buildExecutionScheduleDocument({ enabled: false } as UpsertPlaybookScheduleDto, null);
    const playbook = await this.playbookModel
      .findByIdAndUpdate(playbookId, { $set: { executionSchedule: disabledSchedule } }, { new: true })
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    this.logger.log('Playbook schedule cleared', { playbookId });
    return await this.mapToResponse(playbook as any);
  }

  async delete(playbookId: string): Promise<void> {
    const playbook = await this.playbookModel
      .findByIdAndUpdate(playbookId, { $set: { isActive: false } })
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    this.logger.log('Playbook soft deleted', { playbookId });
  }

  async bulkDelete(userId: string, playbookIds: string[]): Promise<{ deleted: number }> {
    const objectIds = playbookIds.map((id) => new Types.ObjectId(id));
    const result = await this.playbookModel.updateMany(
      { _id: { $in: objectIds }, createdBy: new Types.ObjectId(userId), isActive: true },
      { $set: { isActive: false } },
    );
    this.logger.log('Playbooks bulk soft deleted', { userId, count: result.modifiedCount });
    return { deleted: result.modifiedCount };
  }

  async toggleFavorite(playbookId: string): Promise<{ isFavorite: boolean }> {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }
    const newValue = !playbook.isFavorite;
    await this.playbookModel.findByIdAndUpdate(playbookId, { $set: { isFavorite: newValue } });
    return { isFavorite: newValue };
  }

  async findRawById(playbookId: string): Promise<PlaybookDocument | null> {
    return this.playbookModel.findById(playbookId).exec();
  }

  // Execution history methods

  async findExecutionsByPlaybook(
    playbookId: string,
    params: ExecutionQueryDto,
  ): Promise<PaginatedExecutions> {
    const { page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const query = { playbookId: new Types.ObjectId(playbookId) };

    const [executions, total] = await Promise.all([
      this.executionModel
        .find(query)
        .select('-taskResults -playbookSnapshot -interruptPayload -threadId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.executionModel.countDocuments(query),
    ]);

    return {
      executions: executions.map((e) => this.mapExecutionToSummaryResponse(e as any)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findExecutionById(
    playbookId: string,
    executionId: string,
  ): Promise<PlaybookExecutionResponse> {
    const execution = await this.executionModel
      .findOne({
        _id: new Types.ObjectId(executionId),
        playbookId: new Types.ObjectId(playbookId),
      })
      .lean()
      .exec();

    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    return this.mapExecutionToResponse(execution as any);
  }

  async deleteExecution(
    playbookId: string,
    executionId: string,
  ): Promise<void> {
    const execution = await this.executionModel
      .findOneAndDelete({
        _id: new Types.ObjectId(executionId),
        playbookId: new Types.ObjectId(playbookId),
      })
      .lean()
      .exec();

    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    this.logger.log('Playbook execution deleted', { playbookId, executionId });
  }

  async deleteStepExecution(
    playbookId: string,
    executionId: string,
    taskId: string,
    stepExecutionId: string,
  ): Promise<void> {
    const execution = await this.executionModel
      .findOne({
        _id: new Types.ObjectId(executionId),
        playbookId: new Types.ObjectId(playbookId),
      })
      .lean()
      .exec();

    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    const taskResult = (execution.taskResults || []).find((task: any) => task.taskId === taskId);
    if (!taskResult) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND);
    }

    const stepExecutions = taskResult.stepExecutions || [];
    const target = stepExecutions.find((entry: any) => entry.id === stepExecutionId);
    if (!target) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if ((taskResult.attemptNumber ?? null) === (target.attemptNumber ?? null)) {
      throw new BadRequestException('Cannot delete the current step execution.');
    }

    await this.executionModel.updateOne(
      {
        _id: new Types.ObjectId(executionId),
        playbookId: new Types.ObjectId(playbookId),
        'taskResults.taskId': taskId,
      },
      {
        $set: {
          'taskResults.$.stepExecutions': stepExecutions.filter((entry: any) => entry.id !== stepExecutionId),
        },
      },
    ).exec();

    this.logger.log('Playbook step execution deleted', { playbookId, executionId, taskId, stepExecutionId });
  }

  async deleteExecutions(
    playbookId: string,
  ): Promise<{ deleted: number; kept: number }> {
    const protectedStatuses = [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED];

    const kept = await this.executionModel.countDocuments({
      playbookId: new Types.ObjectId(playbookId),
      status: { $in: protectedStatuses },
    }).exec();

    const result = await this.executionModel.deleteMany({
      playbookId: new Types.ObjectId(playbookId),
      status: { $nin: protectedStatuses },
    }).exec();

    const deleted = result.deletedCount || 0;

    this.logger.log('Playbook executions bulk deleted', { playbookId, deleted, kept });

    return { deleted, kept };
  }

  async getNextExecutionNumber(playbookId: string): Promise<number> {
    const lastExecution = await this.executionModel
      .findOne({ playbookId: new Types.ObjectId(playbookId) })
      .sort({ executionNumber: -1 })
      .select('executionNumber')
      .lean()
      .exec();

    return (lastExecution?.executionNumber || 0) + 1;
  }

  async getDesignMessages(playbookId: string): Promise<PlaybookDesignMessageResponse[]> {
    const messages = await this.designMessageModel
      .find({ playbookId: new Types.ObjectId(playbookId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return messages.map((m: any) => ({
      id: (m._id || m.id).toString(),
      playbookId: m.playbookId.toString(),
      userQuery: m.userQuery,
      aiSummary: m.aiSummary || '',
      snapshotBefore: m.snapshotBefore || { tasks: [], edges: [] },
      status: m.status,
      revertedFromMessageId: m.revertedFromMessageId?.toString() || null,
      error: m.error || null,
      createdAt: m.createdAt?.toISOString?.() || m.createdAt,
      updatedAt: m.updatedAt?.toISOString?.() || m.updatedAt,
    }));
  }

  async revertToSnapshot(
    playbookId: string,
    messageId: string,
    userId: string,
  ): Promise<{ playbook: PlaybookResponse; message: PlaybookDesignMessageResponse }> {
    const originalMessage = await this.designMessageModel
      .findOne({
        _id: new Types.ObjectId(messageId),
        playbookId: new Types.ObjectId(playbookId),
      })
      .lean()
      .exec();

    if (!originalMessage) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    // Snapshot current state before reverting
    const currentPlaybook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!currentPlaybook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const snapshotBefore = {
      tasks: (currentPlaybook as any).tasks || [],
      edges: (currentPlaybook as any).edges || [],
    };

    const targetSnapshot = (originalMessage as any).snapshotBefore;
    const playbook = await this.playbookModel
      .findByIdAndUpdate(
        playbookId,
        { $set: { tasks: targetSnapshot.tasks, edges: targetSnapshot.edges } },
        { new: true },
      )
      .lean()
      .exec();

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    // Create a revert message in the timeline
    const revertMessage = await this.designMessageModel.create({
      playbookId: new Types.ObjectId(playbookId),
      createdBy: new Types.ObjectId(userId),
      userQuery: '',
      aiSummary: '',
      snapshotBefore,
      status: 'reverted',
      revertedFromMessageId: new Types.ObjectId(messageId),
      error: null,
    });

    this.logger.log('Playbook reverted to snapshot', { playbookId, messageId, revertMessageId: revertMessage._id.toString() });

    const mappedMessage: PlaybookDesignMessageResponse = {
      id: revertMessage._id.toString(),
      playbookId: revertMessage.playbookId.toString(),
      userQuery: '',
      aiSummary: '',
      snapshotBefore,
      status: 'reverted',
      revertedFromMessageId: messageId,
      error: null,
      createdAt: revertMessage.createdAt?.toISOString?.() || revertMessage.createdAt as any,
      updatedAt: revertMessage.updatedAt?.toISOString?.() || revertMessage.updatedAt as any,
    };

    return {
      playbook: await this.mapToResponse(playbook as any),
      message: mappedMessage,
    };
  }

  private async cloneExecutionsForPlaybook(
    sourcePlaybookId: string,
    clonedPlaybookId: string,
    targetUserId: string,
  ): Promise<void> {
    const sourceExecutions = await this.executionModel
      .find({
        playbookId: new Types.ObjectId(sourcePlaybookId),
        status: { $nin: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] },
      })
      .sort({ executionNumber: 1, createdAt: 1 })
      .lean()
      .exec();

    if (sourceExecutions.length === 0) {
      return;
    }

    const targetPlaybookObjectId = new Types.ObjectId(clonedPlaybookId);
    const targetUserObjectId = new Types.ObjectId(targetUserId);

    await this.executionModel.insertMany(
      sourceExecutions.map((execution: any) => {
        const { _id, id, __v, createdAt, updatedAt, ...rest } = execution;

        return {
          ...rest,
          playbookId: targetPlaybookObjectId,
          executedBy: targetUserObjectId,
          threadId: null,
          attemptHistory: (execution.attemptHistory || []).map((attempt: any) => ({
            ...attempt,
            threadId: null,
          })),
        };
      }),
    );
  }

  private mapToSummaryResponse(playbook: any): PlaybookSummaryResponse {
    return {
      id: (playbook._id || playbook.id).toString(),
      name: playbook.name,
      description: playbook.description || '',
      taskCount: playbook.taskCount ?? 0,
      isFavorite: playbook.isFavorite || false,
      scheduleEnabled: Boolean(playbook.scheduleEnabled),
      lastExecutionAt: playbook.lastExecutionAt?.toISOString?.() || playbook.lastExecutionAt || null,
      createdAt: playbook.createdAt?.toISOString?.() || playbook.createdAt,
      updatedAt: playbook.updatedAt?.toISOString?.() || playbook.updatedAt,
    };
  }

  private async mapToResponse(playbook: any): Promise<PlaybookResponse> {
    const taskIds = (playbook.tasks || []).map((t: any) => t.id);
    const activeReplays = await this.replayService.getActiveReplays(
      (playbook._id || playbook.id).toString(),
      taskIds,
    );
    const activeOutputFormats = await this.outputFormatService.getActiveTemplates(
      (playbook._id || playbook.id).toString(),
      taskIds,
    );

    return {
      id: (playbook._id || playbook.id).toString(),
      name: playbook.name,
      description: playbook.description || '',
      tasks: (playbook.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || '',
        assignedAgentId: t.assignedAgentId?.toString() || null,
        executionOrder: t.executionOrder || 0,
        positionX: t.positionX || 0,
        positionY: t.positionY || 0,
        interruptBefore: t.interruptBefore || false,
        interruptAfter: t.interruptAfter || false,
        allowClarification: t.allowClarification || false,
        clarificationPrompt: t.clarificationPrompt || '',
        maxClarifications: t.maxClarifications || 3,
        inputKeys: t.inputKeys || [],
        outputKey: t.outputKey || '',
        notifyOnComplete: t.notifyOnComplete || false,
        notifyEmails: t.notifyEmails || [],
        inputFiles: t.inputFiles || [],
        enabled: t.enabled !== false,
        taskType: t.taskType || null,
        inputPorts: t.inputPorts || [],
        outputPorts: t.outputPorts || [],
        hasValidatedReplay: activeReplays.has(t.id),
        activeReplayId: activeReplays.get(t.id)?.id || null,
        activeReplayVersion: activeReplays.get(t.id)?.validationVersion || null,
        activeReplayIsStale: activeReplays.get(t.id)?.isStale || false,
        activeReplayStaleReasons: activeReplays.get(t.id)?.staleReasons || [],
        activeReplayPreserveOutputFormat: activeReplays.get(t.id)?.preserveOutputFormat || false,
        activeReplayFormatGuideStatus: activeReplays.get(t.id)?.formatGuideStatus || 'disabled',
        activeReplayFormatGuideError: activeReplays.get(t.id)?.formatGuideError || null,
        hasOutputFormatTemplate: activeOutputFormats.has(t.id),
        activeOutputFormatTemplateId: activeOutputFormats.get(t.id)?.id || null,
        activeOutputFormatTemplateVersion: activeOutputFormats.get(t.id)?.templateVersion || null,
        activeOutputFormatStatus: activeOutputFormats.get(t.id)?.generationStatus || null,
        activeOutputFormatError: activeOutputFormats.get(t.id)?.generationError || null,
        stepReplayMode: t.stepReplayMode || 'live',
      })),
      edges: (playbook.edges || []).map((e: any) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        sourceOutputPortId: e.sourceOutputPortId || 'default',
        targetInputPortId: e.targetInputPortId || 'default',
      })),
      workspaces: (playbook.workspaces || []).map((w: any) => w.toString()),
      createdBy: playbook.createdBy.toString(),
      isFavorite: playbook.isFavorite || false,
      isActive: playbook.isActive,
      executionSchedule: mapExecutionScheduleToData(playbook.executionSchedule),
      createdAt: playbook.createdAt?.toISOString?.() || playbook.createdAt,
      updatedAt: playbook.updatedAt?.toISOString?.() || playbook.updatedAt,
    };
  }

  private mapExecutionToSummaryResponse(execution: any): PlaybookExecutionSummaryResponse {
    return {
      id: (execution._id || execution.id).toString(),
      playbookId: execution.playbookId.toString(),
      executedBy: execution.executedBy.toString(),
      executionNumber: execution.executionNumber,
      currentAttemptNumber: execution.currentAttemptNumber ?? 1,
      status: execution.status,
      executionTrigger: execution.executionTrigger === 'scheduled' ? 'scheduled' : 'manual',
      error: execution.error,
      durationMs: execution.durationMs,
      startedAt: execution.startedAt?.toISOString?.() || execution.startedAt,
      completedAt: execution.completedAt?.toISOString?.() || execution.completedAt,
      singleStepTaskId: execution.singleStepTaskId,
      createdAt: execution.createdAt?.toISOString?.() || execution.createdAt,
      updatedAt: execution.updatedAt?.toISOString?.() || execution.updatedAt,
    };
  }

  private mapExecutionToResponse(execution: any): PlaybookExecutionResponse {
    return {
      id: (execution._id || execution.id).toString(),
      playbookId: execution.playbookId.toString(),
      executedBy: execution.executedBy.toString(),
      executionNumber: execution.executionNumber,
      currentAttemptNumber: execution.currentAttemptNumber ?? 1,
      status: execution.status,
      executionMode: execution.executionMode || 'live',
      executionTrigger: execution.executionTrigger === 'scheduled' ? 'scheduled' : 'manual',
      replaySourceByTask: execution.replaySourceByTask || null,
      taskResults: (execution.taskResults || []).map((tr: any) => ({
        taskId: tr.taskId,
        nodeTitle: tr.nodeTitle,
        agentName: tr.agentName || '',
        order: tr.order,
        status: tr.status,
        output: tr.output,
        error: tr.error,
        durationMs: tr.durationMs,
        startedAt: tr.startedAt?.toISOString?.() || tr.startedAt,
        completedAt: tr.completedAt?.toISOString?.() || tr.completedAt,
        components: tr.components || [],
        toolTrace: tr.toolTrace || [],
        llmPromptTrace: tr.llmPromptTrace || [],
        inputTokens: tr.inputTokens ?? null,
        outputTokens: tr.outputTokens ?? null,
        totalTokens: tr.totalTokens ?? null,
        modelName: tr.modelName ?? null,
        attemptNumber: tr.attemptNumber ?? 1,
        isStale: Boolean(tr.isStale),
        staleReason: tr.staleReason ?? null,
        invalidatedByTaskId: tr.invalidatedByTaskId ?? null,
        semanticMatch: tr.semanticMatch ?? null,
        artifacts: tr.artifacts || [],
        evaluationHistory: (tr.evaluationHistory || []).map((entry: any) => ({
          id: entry.id,
          createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
          attemptNumber: entry.attemptNumber ?? null,
          trigger: entry.trigger || 'manual',
          baselineReplayId: entry.baselineReplayId ?? null,
          baselineValidationVersion: entry.baselineValidationVersion ?? null,
          semanticMatch: entry.semanticMatch,
        })),
        stepExecutions: (tr.stepExecutions || []).map((entry: any) => ({
          id: entry.id,
          attemptNumber: entry.attemptNumber ?? null,
          status: entry.status,
          output: entry.output ?? null,
          error: entry.error ?? null,
          durationMs: entry.durationMs ?? null,
          startedAt: entry.startedAt?.toISOString?.() || entry.startedAt || null,
          completedAt: entry.completedAt?.toISOString?.() || entry.completedAt || null,
          components: entry.components || [],
          toolTrace: entry.toolTrace || [],
          llmPromptTrace: entry.llmPromptTrace || [],
          inputTokens: entry.inputTokens ?? null,
          outputTokens: entry.outputTokens ?? null,
          totalTokens: entry.totalTokens ?? null,
          modelName: entry.modelName ?? null,
          artifacts: entry.artifacts || [],
        })),
      })),
      threadId: execution.threadId,
      interruptPayload: execution.interruptPayload,
      error: execution.error,
      durationMs: execution.durationMs,
      startedAt: execution.startedAt?.toISOString?.() || execution.startedAt,
      completedAt: execution.completedAt?.toISOString?.() || execution.completedAt,
      singleStepTaskId: execution.singleStepTaskId,
      playbookSnapshot: execution.playbookSnapshot,
      totalInputTokens: execution.totalInputTokens ?? 0,
      totalOutputTokens: execution.totalOutputTokens ?? 0,
      totalTokens: execution.totalTokens ?? 0,
      attemptHistory: (execution.attemptHistory || []).map((attempt: any) => ({
        attemptNumber: attempt.attemptNumber,
        type: attempt.type,
        taskId: attempt.taskId ?? null,
        threadId: attempt.threadId ?? null,
        startedAt: attempt.startedAt?.toISOString?.() || attempt.startedAt,
        completedAt: attempt.completedAt?.toISOString?.() || attempt.completedAt || null,
      })),
      createdAt: execution.createdAt?.toISOString?.() || execution.createdAt,
      updatedAt: execution.updatedAt?.toISOString?.() || execution.updatedAt,
    };
  }
}
