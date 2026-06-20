import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyServiceAuthGuard } from '../guards/worky-service-auth.guard';
import { WorkyIdempotencyService } from '../services/worky-idempotency.service';
import { WorkyAuditService } from '../services/worky-audit.service';
import { WorkyPlanDeltaService } from '../services/worky-plan-delta.service';
import { WorkyEventService } from '../services/worky-event.service';
import { WorkyGovernanceService } from '../services/worky-governance.service';
import { WorkyEphemeralWorkerService, IWorkyWorkerBinding } from '../services/worky-ephemeral-worker.service';
import { WorkyExecutionService } from '../services/worky-execution.service';
import { WorkyBudgetService } from '../services/worky-budget.service';
import { WorkyInteractionService } from '../services/worky-interaction.service';
import { WorkyTaskResultService } from '../services/worky-task-result.service';
import { InternalPlanDeltaDto } from '../dto/internal-plan-delta.dto';
import { InternalSpawnWorkerDto } from '../dto/internal-spawn-worker.dto';
import { InternalInteractionDto } from '../dto/internal-interaction.dto';
import { InternalGovernanceCheckDto } from '../dto/internal-governance-check.dto';
import { InternalBudgetReserveDto } from '../dto/internal-budget-reserve.dto';
import { InternalCostEventDto } from '../dto/internal-cost-event.dto';
import { InternalArtifactDto } from '../dto/internal-artifact.dto';
import { InternalAuditDto } from '../dto/internal-audit.dto';
import { InternalTaskResultDto } from '../dto/internal-task-result.dto';
import {
  IWorkyCallbackAck,
  IWorkyPlanDeltaAck,
} from '../interfaces/worky-stream.interface';
import { LoggerService } from '../../logger';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import {
  WorkyInteraction,
  WorkyInteractionDocument,
} from '../schemas/worky-interaction.schema';

/**
 * Runtime → NestJS state-mutation callbacks (canonical §6.2). Every endpoint
 * is guarded by `WorkyServiceAuthGuard` and gated by
 * `WorkyIdempotencyService.claim` so the same `(streamId, eventId)` is
 * a no-op on replay. Part 1 + Part 2 wired `plan-delta`; Part 3 wires
 * `governance/check`, `spawn-worker`, `interaction`, `cost-event`, and
 * `tasks/{id}/result` to their respective services.
 */
@ApiTags('Worky (internal)')
// The runtime is service-to-service; the global APP_GUARD (JwtAuthGuard)
// must be bypassed so the per-route `WorkyServiceAuthGuard` is the
// actual gate. Without `@Public()` the global guard rejects the
// request with 401 before the service-token check runs (the runtime
// has no JWT to present).
@Public()
@UseGuards(WorkyServiceAuthGuard)
@Controller('worky/internal')
export class WorkyInternalController {
  constructor(
    private readonly streams: WorkyStreamService,
    private readonly idempotency: WorkyIdempotencyService,
    private readonly audit: WorkyAuditService,
    private readonly planDeltaService: WorkyPlanDeltaService,
    private readonly events: WorkyEventService,
    private readonly governance: WorkyGovernanceService,
    private readonly workerBinding: WorkyEphemeralWorkerService,
    private readonly execution: WorkyExecutionService,
    private readonly budget: WorkyBudgetService,
    @InjectModel(WorkyTask.name)
    private readonly taskModel: Model<WorkyTaskDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteractionDocument>,
    private readonly taskResults: WorkyTaskResultService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyInternalController.name);
  }

  @Post('streams/:id/plan-delta')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS plan-delta callback' })
  async planDelta(
    @Param('id') streamId: string,
    @Body() dto: InternalPlanDeltaDto,
  ): Promise<IWorkyPlanDeltaAck> {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idempotency = await this.idempotency.claim(streamId, dto.eventId, 'plan-delta');
    if (idempotency.replay) {
      return this.planDeltaAck(dto.eventId, true, 0, '', [], [], [], []);
    }
    const result = await this.planDeltaService.apply({
      streamId,
      basePlanVersion: dto.basePlanVersion,
      triggerEventId: dto.eventId,
      body: dto.body ?? {},
      createdBy: stream.ownerUserId.toString(),
    });
    await this.audit.append({
      streamId,
      actorUserId: null,
      action: 'runtime.plan-delta',
      targetType: 'stream',
      targetId: streamId,
      details: {
        basePlanVersion: dto.basePlanVersion,
        resultPlanVersion: result.resultPlanVersion,
        createdTaskIds: result.createdTaskIds.length,
        updatedTaskIds: result.updatedTaskIds.length,
        cancelledTaskIds: result.cancelledTaskIds.length,
        planDeltaId: result.planDeltaId,
      },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'plan.delta.applied',
      emittedAt: Date.now(),
      payload: {
        planDeltaId: result.planDeltaId,
        basePlanVersion: result.basePlanVersion,
        resultPlanVersion: result.resultPlanVersion,
        createdTaskIds: result.createdTaskIds,
        updatedTaskIds: result.updatedTaskIds,
        cancelledTaskIds: result.cancelledTaskIds,
      },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'plan.version.created',
      emittedAt: Date.now(),
      payload: { planVersion: result.resultPlanVersion },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { reason: 'plan-delta-applied' },
    });
    return this.planDeltaAck(
      dto.eventId,
      false,
      result.resultPlanVersion,
      result.planDeltaId,
      result.createdTaskIds,
      result.updatedTaskIds,
      result.cancelledTaskIds,
      result.clarificationIds,
    );
  }

  /**
   * Runtime → NestJS replan callback. Used by the runtime to push a
   * dynamic replan during execution. The plan-delta service applies the
   * governance guard; if approval is required, the body is persisted as
   * `pending_approval` and a `replan_review` interaction is raised.
   */
  @Post('streams/:id/replan')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS replan callback (Part 4 §5)' })
  async replan(
    @Param('id') streamId: string,
    @Body() dto: InternalPlanDeltaDto,
  ): Promise<
    IWorkyCallbackAck & {
      planDeltaId: string;
      status: 'auto_applied' | 'pending_approval' | 'rejected';
      blockingCategories?: string[];
      interactionId?: string;
    }
  > {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'replan');
    if (idem.replay) {
      return {
        ...this.ack(dto.eventId, true),
        planDeltaId: '',
        status: 'auto_applied',
      };
    }
    await this.audit.append({
      streamId,
      actorUserId: null,
      action: 'runtime.replan',
      targetType: 'stream',
      targetId: streamId,
      details: { basePlanVersion: dto.basePlanVersion, body: dto.body ?? {} },
    });
    const result = await this.planDeltaService.applyReplan({
      streamId,
      basePlanVersion: dto.basePlanVersion,
      triggerEventId: dto.eventId,
      body: dto.body ?? {},
      createdBy: stream.ownerUserId.toString(),
      reason: dto.reason ?? 'replan',
      applyMode: 'auto',
    });
    return {
      ...this.ack(dto.eventId, false),
      planDeltaId: result.planDeltaId,
      status: result.status,
      blockingCategories: result.blockingCategories,
      interactionId: result.interactionId,
    };
  }

  @Post('streams/:id/spawn-worker')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS spawn-worker callback' })
  async spawnWorker(
    @Param('id') streamId: string,
    @Body() dto: InternalSpawnWorkerDto,
  ): Promise<IWorkyCallbackAck & { binding: IWorkyWorkerBinding | null }> {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'spawn-worker');
    if (idem.replay) {
      return { ...this.ack(dto.eventId, true), binding: null };
    }
    const binding = await this.workerBinding.bindForTask({
      streamId,
      taskId: dto.taskId,
      role: dto.role ?? 'ephemeral_ai_agent',
      toolRefs: dto.toolRefs ?? [],
    });
    return { ...this.ack(dto.eventId, false), binding };
  }

  @Post('streams/:id/interaction')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS interaction request' })
  async interaction(
    @Param('id') streamId: string,
    @Body() dto: InternalInteractionDto,
  ): Promise<IWorkyCallbackAck & { interactionId: string | null }> {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'interaction');
    if (idem.replay) {
      const existing = await this.interactions
        .findOne({ streamId: stream._id, eventId: dto.eventId })
        .select({ _id: 1 })
        .lean()
        .exec();
      return {
        ...this.ack(dto.eventId, true),
        interactionId: existing ? (existing._id as Types.ObjectId).toString() : null,
      };
    }
    const interaction = await this.interactions.create({
      streamId: stream._id,
      taskId: dto.taskId && Types.ObjectId.isValid(dto.taskId) ? new Types.ObjectId(dto.taskId) : null,
      type: dto.type,
      question: dto.question ?? '',
      options: dto.options ?? [],
      status: 'pending',
      blockingScope: dto.blockingScope ?? 'task',
      blocksTaskIds:
        dto.blockingScope === 'task' && dto.taskId && Types.ObjectId.isValid(dto.taskId)
          ? [new Types.ObjectId(dto.taskId)]
          : [],
      targetUserId: stream.ownerUserId,
      metadata: dto.metadata ?? {},
    });
    await this.audit.append({
      streamId,
      actorUserId: null,
      action: 'runtime.interaction',
      targetType: 'stream',
      targetId: streamId,
      details: {
        interactionId: (interaction._id as Types.ObjectId).toString(),
        type: dto.type,
        taskId: dto.taskId,
      },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'interaction.requested',
      emittedAt: Date.now(),
      payload: {
        interactionId: (interaction._id as Types.ObjectId).toString(),
        type: interaction.type,
        taskId: interaction.taskId ? interaction.taskId.toString() : null,
        question: interaction.question,
        options: interaction.options ?? [],
      },
    });
    return {
      ...this.ack(dto.eventId, false),
      interactionId: (interaction._id as Types.ObjectId).toString(),
    };
  }

  @Post('streams/:id/governance/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Runtime → NestJS governance check' })
  async governanceCheck(
    @Param('id') streamId: string,
    @Body() dto: InternalGovernanceCheckDto,
  ): Promise<
    IWorkyCallbackAck & {
      resolvedLevel: string;
      source: string;
      allowStreamOwnerOverride: boolean;
      maxOwnerRelaxLevel: string;
    }
  > {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    // Governance is idempotent because the resolution is a pure function
    // of (streamId, category, overrideLevel). We still record an audit
    // row in `WorkyGovernanceService.resolve`.
    const result = await this.governance.resolve(streamId, dto.category, dto.overrideLevel);
    return {
      ...this.ack(dto.eventId, false),
      resolvedLevel: result.resolvedLevel,
      source: result.source,
      allowStreamOwnerOverride: result.allowStreamOwnerOverride,
      maxOwnerRelaxLevel: result.maxOwnerRelaxLevel,
    };
  }

  @Post('streams/:id/budget/reserve')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS budget reservation' })
  async budgetReserve(
    @Param('id') streamId: string,
    @Body() dto: InternalBudgetReserveDto,
  ): Promise<
    IWorkyCallbackAck & {
      reservationStatus: 'reserved' | 'denied';
      reservationId?: string;
      reason?: string;
    }
  > {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'budget/reserve');
    if (idem.replay) {
      return {
        ...this.ack(dto.eventId, true),
        reservationStatus: 'reserved',
      };
    }
    await this.audit.append({
      streamId,
      action: 'runtime.budget/reserve',
      targetType: 'stream',
      targetId: streamId,
      details: { taskId: dto.taskId, amountUsd: dto.amountUsd, tokens: dto.tokens },
    });
    const result = await this.budget.reserve({
      streamId,
      taskId: dto.taskId,
      amountUsd: dto.amountUsd,
      tokens: dto.tokens,
    });
    return {
      ...this.ack(dto.eventId, false),
      reservationStatus: result.status,
      reservationId: result.reservationId,
      reason: result.reason,
    };
  }

  @Post('streams/:id/cost-event')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS cost event' })
  async costEvent(
    @Param('id') streamId: string,
    @Body() dto: InternalCostEventDto,
  ): Promise<
    IWorkyCallbackAck & {
      costEventId?: string;
      totalCostUsd?: number;
      totalTokens?: number;
      overspend?: boolean;
    }
  > {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'cost-event');
    if (idem.replay) {
      return { ...this.ack(dto.eventId, true) };
    }
    const result = await this.budget.recordCost({
      streamId,
      taskId: dto.taskId ?? null,
      type: dto.type as 'llm' | 'tool' | 'embedding',
      provider: dto.provider,
      modelId: dto.model,
      inputTokens: dto.inputTokens ?? 0,
      outputTokens: dto.outputTokens ?? 0,
      costUsd: dto.costUsd ?? 0,
    });
    await this.audit.append({
      streamId,
      action: 'runtime.cost-event',
      targetType: 'stream',
      targetId: streamId,
      details: {
        taskId: dto.taskId,
        type: dto.type,
        provider: dto.provider,
        model: dto.model,
        costUsd: dto.costUsd,
        inputTokens: dto.inputTokens,
        outputTokens: dto.outputTokens,
      },
    });
    this.events.emit(stream.ownerUserId.toString(), streamId, {
      type: 'cost.recorded',
      emittedAt: Date.now(),
      payload: {
        taskId: dto.taskId ?? null,
        type: dto.type,
        provider: dto.provider,
        model: dto.model,
        inputTokens: dto.inputTokens ?? 0,
        outputTokens: dto.outputTokens ?? 0,
        costUsd: dto.costUsd ?? 0,
        totalCostUsd: result.totalCostUsd,
        totalTokens: result.totalTokens,
      },
    });
    return {
      ...this.ack(dto.eventId, false),
      costEventId: result.costEventId,
      totalCostUsd: result.totalCostUsd,
      totalTokens: result.totalTokens,
      overspend: result.overspend,
    };
  }

  @Post('streams/:id/artifact')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS artifact persistence' })
  async artifact(
    @Param('id') streamId: string,
    @Body() dto: InternalArtifactDto,
  ): Promise<IWorkyCallbackAck> {
    const result = await this.handle(streamId, 'artifact', dto.eventId, {
      uri: dto.uri,
      taskId: dto.taskId,
      metadata: dto.metadata,
    });
    if (result.replay) return result;
    if (Types.ObjectId.isValid(streamId)) {
      const stream = await this.streams.findByIdInternal(streamId);
      if (stream) {
        this.events.emit(stream.ownerUserId.toString(), streamId, {
          type: 'artifact.persisted',
          emittedAt: Date.now(),
          payload: { uri: dto.uri, taskId: dto.taskId ?? null, metadata: dto.metadata ?? {} },
        });
      }
    }
    return result;
  }

  @Post('streams/:id/audit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS audit event' })
  async auditEvent(
    @Param('id') streamId: string,
    @Body() dto: InternalAuditDto,
  ): Promise<IWorkyCallbackAck> {
    const result = await this.handle(streamId, 'audit', dto.eventId, {
      action: dto.action,
      details: dto.details,
    });
    if (!result.replay) {
      await this.audit.append({
        streamId,
        actorUserId: null,
        action: dto.action,
        details: dto.details,
      });
    }
    return result;
  }

  @Post('tasks/:id/result')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS task result' })
  async taskResult(
    @Param('id') taskId: string,
    @Body() dto: InternalTaskResultDto,
  ): Promise<IWorkyCallbackAck> {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new NotFoundException(
        ErrorCode.WORKY_TASK_NOT_FOUND,
        'Worky task not found.',
      );
    }
    const idem = await this.idempotency.claim(taskId, dto.eventId, 'task-result');
    if (idem.replay) {
      return this.ack(dto.eventId, true);
    }
    const task = await this.taskModel.findById(taskId).lean().exec();
    if (!task) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }
    const streamId = (task.streamId as Types.ObjectId).toString();
    const stream = await this.streams.findByIdInternal(streamId);
    const persisted = await this.taskResults.record({
      taskId,
      status: dto.status,
      summary: dto.summary ?? '',
      contentArtifactId: dto.contentArtifactId ?? null,
      createdByWorkerId: dto.createdByWorkerId ?? null,
    });
    if (stream) {
      this.events.emit(stream.ownerUserId.toString(), streamId, {
        type: 'task.completed',
        emittedAt: Date.now(),
        payload: {
          taskId,
          status: dto.status,
          summary: dto.summary ?? '',
          taskResultId: persisted.taskResultId,
          version: persisted.version,
        },
      });
    }
    await this.audit.append({
      streamId,
      actorUserId: null,
      action: 'runtime.task-result',
      targetType: 'task',
      targetId: taskId,
      details: { status: dto.status, version: persisted.version },
    });
    return this.ack(dto.eventId, false);
  }

  // ===== Helpers =====

  private async handle(
    streamId: string,
    callback: string,
    eventId: string,
    details: Record<string, unknown>,
  ): Promise<IWorkyCallbackAck & { interactionId?: string | null }> {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const result = await this.idempotency.claim(streamId, eventId, callback);
    if (result.firstSeen) {
      this.logger.log(`Worky callback ${callback} accepted`, { streamId, eventId });
      await this.audit.append({
        streamId,
        actorUserId: null,
        action: `runtime.${callback}`,
        targetType: 'stream',
        targetId: streamId,
        details,
      });
    }
    return this.ack(eventId, result.replay);
  }

  private ack(eventId: string, replay: boolean): IWorkyCallbackAck {
    return {
      applied: !replay,
      replay,
      eventId,
      receivedAt: new Date().toISOString(),
    };
  }

  private planDeltaAck(
    eventId: string,
    replay: boolean,
    resultPlanVersion: number,
    planDeltaId: string,
    createdTaskIds: string[],
    updatedTaskIds: string[],
    cancelledTaskIds: string[],
    clarificationIds: string[],
  ): IWorkyPlanDeltaAck {
    return {
      applied: !replay,
      replay,
      eventId,
      receivedAt: new Date().toISOString(),
      resultPlanVersion,
      planDeltaId,
      createdTaskIds,
      updatedTaskIds,
      cancelledTaskIds,
      clarificationIds,
    };
  }
}
