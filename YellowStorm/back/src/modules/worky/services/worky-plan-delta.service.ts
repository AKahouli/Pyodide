import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyStream, WorkyStreamDocument } from '../schemas/worky-stream.schema';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyPlanVersion, WorkyPlanVersionDocument } from '../schemas/worky-plan-version.schema';
import { WorkyPlanDelta, WorkyPlanDeltaDocument } from '../schemas/worky-plan-delta.schema';
import {
  WorkyInteraction,
  WorkyInteractionDocument,
} from '../schemas/worky-interaction.schema';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PlanDeltaBodyDto } from '../dto/plan-delta-body.dto';
import { IPlanDeltaApplyResult, IPlanDeltaBody } from '../interfaces/plan-delta.interface';
import { WorkyHumanAssignmentService } from './worky-human-assignment.service';
import { WorkyGovernanceService } from './worky-governance.service';
import { WorkyEventService } from './worky-event.service';

export interface PlanDeltaApplyInput {
  streamId: string;
  basePlanVersion: number;
  triggerEventId: string;
  body: PlanDeltaBodyDto;
  createdBy: string;
}

export interface PlanDeltaReplanInput {
  streamId: string;
  basePlanVersion: number;
  triggerEventId: string;
  body: PlanDeltaBodyDto;
  createdBy: string;
  /** Reason / trigger description recorded on the delta row. */
  reason: string;
  /**
   * `auto` = orchestrator-chosen, may still be promoted to `pending_approval`
   * by the governance guard; `manual` = always requires owner approval.
   */
  applyMode: 'auto' | 'manual';
}

export interface IPlanDeltaReplanResult {
  status: 'auto_applied' | 'pending_approval' | 'rejected';
  planDeltaId: string;
  blockingCategories?: string[];
  reason?: string;
  resultPlanVersion?: number;
  createdTaskIds?: string[];
  updatedTaskIds?: string[];
  cancelledTaskIds?: string[];
  interactionId?: string;
}

/**
 * Plan-delta validation/versioning/apply pipeline (canonical §3.2):
 *   1. Concurrency check (`basePlanVersion == stream.currentPlanVersion`).
 *   2. Schema-validate (already done by `class-validator` at the DTO layer).
 *   3. Graph validate (no cycles, all `dependsOn` refs exist in the stream).
 *   4. Governance classification — the `actionCategory` tag is persisted on
 *      the task itself; enforcement is out of Part 2 scope.
 *   5. Atomic apply (best-effort linearization via the version increment).
 *   6. Versioning — create a `WorkyPlanVersion` and link the delta.
 *
 * The `findOneAndUpdate` on `currentPlanVersion` is the linearization
 * point: a concurrent caller that raced to this point will see
 * `null` and get a `stale_base_version` 409. The delta is then persisted
 * with `status='rejected'` so a future audit can see it was attempted.
 *
 * Cancel operations set `lane='canceled'`; create / update use the lane
 * supplied by the runtime. System lanes (`failed|canceled|...`) are not
 * in the `BOARD_LANES` projection, so the board does not show them.
 */
@Injectable()
export class WorkyPlanDeltaService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    @InjectModel(WorkyPlanVersion.name)
    private readonly planVersions: Model<WorkyPlanVersionDocument>,
    @InjectModel(WorkyPlanDelta.name)
    private readonly planDeltas: Model<WorkyPlanDeltaDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteractionDocument>,
    private readonly humanAssignment: WorkyHumanAssignmentService,
    private readonly governance: WorkyGovernanceService,
    private readonly events: WorkyEventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyPlanDeltaService.name);
  }

  async apply(input: PlanDeltaApplyInput): Promise<IPlanDeltaApplyResult> {
    return this.applyInternal({ ...input, phase: 'planning', applyMode: 'auto' });
  }

  /**
   * Dynamic replanning during execution (Part 4 §5, canonical §17).
   * Allowed in any non-terminal phase (active / partially_blocked /
   * paused / waiting_for_*). The governance guard consults
   * `WorkyGovernanceService.resolve` for each op's `actionCategory`;
   * if any op resolves to `approval` or `hard_block`, the delta is
   * persisted as `pending_approval` and a `replan_review` interaction
   * is raised. Otherwise the delta is auto-applied and `applied` is
   * returned (canonical §17.4).
   */
  async applyReplan(input: PlanDeltaReplanInput): Promise<IPlanDeltaReplanResult> {
    const stream = await this.streams.findById(input.streamId).exec();
    if (!stream) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (this.isPreExecutionPhase(stream.status)) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        `Replan is only valid during execution (current: ${stream.status}). Use apply() during planning.`,
      );
    }
    if (this.isTerminalPhase(stream.status)) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        `Cannot replan a terminal stream (${stream.status}).`,
      );
    }
    const body = this.normalizeBody(input.body);
    const guard = await this.evaluateReplanGuard(stream._id.toString(), body, input.applyMode);
    if (guard.requiresApproval) {
      const delta = await this.planDeltas.create({
        streamId: stream._id,
        basePlanVersion: input.basePlanVersion,
        resultPlanVersion: stream.currentPlanVersion,
        phase: 'replan',
        triggerEventId: input.triggerEventId,
        status: 'pending_approval',
        applyMode: input.applyMode,
        reason: input.reason,
        createdBy: new Types.ObjectId(input.createdBy),
        body: this.bodyToWire(body),
      });
      const interaction = await this.interactions.create({
        streamId: stream._id,
        taskId: null,
        type: 'replan_review',
        targetUserId: stream.ownerUserId,
        question: `A dynamic replan was triggered${input.reason ? ` (${input.reason})` : ''}. Touches categories: ${guard.blockingCategories.join(', ')}. Approve to apply.`,
        options: ['approve', 'reject'],
        status: 'pending',
        blockingScope: 'stream',
        blocksTaskIds: [],
        respondedAt: null,
        response: null,
        metadata: { planDeltaId: (delta._id as Types.ObjectId).toString() },
      });
      this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
        type: 'replan.approval_required',
        emittedAt: Date.now(),
        payload: {
          planDeltaId: (delta._id as Types.ObjectId).toString(),
          blockingCategories: guard.blockingCategories,
          reason: input.reason,
        },
      });
      this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
        type: 'replan.required',
        emittedAt: Date.now(),
        payload: {
          planDeltaId: (delta._id as Types.ObjectId).toString(),
          reason: input.reason,
          mode: input.applyMode,
        },
      });
      return {
        status: 'pending_approval',
        planDeltaId: (delta._id as Types.ObjectId).toString(),
        blockingCategories: guard.blockingCategories,
        reason: input.reason,
        interactionId: (interaction._id as Types.ObjectId).toString(),
      };
    }
    const result = await this.applyInternal({
      ...input,
      phase: 'replan',
      applyMode: 'auto',
    });
    this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
      type: 'replan.applied',
      emittedAt: Date.now(),
      payload: {
        planDeltaId: result.planDeltaId,
        reason: input.reason,
        resultPlanVersion: result.resultPlanVersion,
      },
    });
    return {
      status: 'auto_applied',
      planDeltaId: result.planDeltaId,
      resultPlanVersion: result.resultPlanVersion,
      createdTaskIds: result.createdTaskIds,
      updatedTaskIds: result.updatedTaskIds,
      cancelledTaskIds: result.cancelledTaskIds,
    };
  }

  /**
   * Apply a previously-`pending_approval` replan delta after the owner
   * has approved it (canonical §17.4). Bypasses the governance guard
   * because the owner has explicitly approved. Idempotent: if the
   * delta is no longer `pending_approval` (e.g. a duplicate approval),
   * returns the existing outcome without re-applying.
   */
  async applyApproved(input: {
    planDeltaId: string;
    approvedBy: string;
  }): Promise<IPlanDeltaReplanResult> {
    const delta = await this.planDeltas
      .findById(input.planDeltaId)
      .lean()
      .exec();
    if (!delta) {
      throw new BadRequestException(
        ErrorCode.WORKY_INVALID_PLAN_DELTA,
        `Worky plan delta ${input.planDeltaId} not found.`,
      );
    }
    if (delta.status === 'applied') {
      return {
        status: 'auto_applied',
        planDeltaId: input.planDeltaId,
        resultPlanVersion: (delta.resultPlanVersion as number | undefined) ?? 0,
      };
    }
    if (delta.status !== 'pending_approval') {
      return {
        status: 'rejected',
        planDeltaId: input.planDeltaId,
      };
    }
    const wireBody = delta.body as Record<string, unknown>;
    const result = await this.applyInternal({
      streamId: (delta.streamId as Types.ObjectId).toString(),
      basePlanVersion: delta.basePlanVersion as number,
      triggerEventId: (delta.triggerEventId as string | undefined) ?? `approved-${input.planDeltaId}`,
      body: wireBody as unknown as PlanDeltaBodyDto,
      createdBy: input.approvedBy,
      phase: 'replan',
      applyMode: 'pending_approval',
    });
    await this.planDeltas
      .updateOne(
        { _id: new Types.ObjectId(input.planDeltaId), status: 'pending_approval' },
        {
          $set: {
            status: 'applied',
            resultPlanVersion: result.resultPlanVersion,
            appliedAt: new Date(),
            approvedBy: new Types.ObjectId(input.approvedBy),
          },
        },
      )
      .exec();
    const streamForEvent = await this.streams
      .findById(delta.streamId)
      .select({ ownerUserId: 1 })
      .lean()
      .exec();
    const ownerUserId = streamForEvent?.ownerUserId.toString() ?? '';
    this.events.emit(ownerUserId, (delta.streamId as Types.ObjectId).toString(), {
      type: 'replan.applied',
      emittedAt: Date.now(),
      payload: {
        planDeltaId: input.planDeltaId,
        resultPlanVersion: result.resultPlanVersion,
      },
    });
    return {
      status: 'auto_applied',
      planDeltaId: input.planDeltaId,
      resultPlanVersion: result.resultPlanVersion,
      createdTaskIds: result.createdTaskIds,
      updatedTaskIds: result.updatedTaskIds,
      cancelledTaskIds: result.cancelledTaskIds,
    };
  }

  private async applyInternal(
    input: PlanDeltaApplyInput & {
      phase: 'planning' | 'replan';
      applyMode: 'auto' | 'manual' | 'pending_approval';
    },
  ): Promise<IPlanDeltaApplyResult> {
    const stream = await this.streams.findById(input.streamId).exec();
    if (!stream) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    if (input.phase === 'planning' && !this.isPreExecutionPhase(stream.status)) {
      throw new BadRequestException(
        ErrorCode.WORKY_STREAM_PHASE_INVALID,
        `Plan deltas can only be applied in a pre-execution phase (current: ${stream.status}).`,
      );
    }
    if (input.basePlanVersion !== stream.currentPlanVersion) {
      throw new ConflictException(
        ErrorCode.WORKY_STALE_PLAN_VERSION,
        `basePlanVersion ${input.basePlanVersion} != currentPlanVersion ${stream.currentPlanVersion}.`,
      );
    }
    const body = this.normalizeBody(input.body);
    if (this.isEmpty(body)) {
      // Empty deltas are persisted as a no-op so the audit trail is complete.
      return this.persistEmptyDelta(stream, input, body);
    }

    // Graph validation
    const existingTasks = await this.tasks
      .find({ streamId: stream._id })
      .select({ _id: 1, title: 1 })
      .lean()
      .exec();
    const existingIds = new Set(existingTasks.map((t) => (t._id as Types.ObjectId).toString()));
    const clientIdMap = new Map<string, Types.ObjectId>();
    const resolution = this.resolveClientTaskIds(body, existingIds);
    if (resolution.cycle) {
      throw new BadRequestException(
        ErrorCode.WORKY_CYCLIC_DEPENDENCY,
        'Plan delta would introduce a task dependency cycle.',
      );
    }
    for (const missing of resolution.missingRefs) {
      throw new BadRequestException(
        ErrorCode.WORKY_INVALID_PLAN_DELTA,
        `dependsOn references unknown task "${missing}".`,
      );
    }
    for (const orphan of resolution.orphans) {
      throw new BadRequestException(
        ErrorCode.WORKY_INVALID_PLAN_DELTA,
        `update_tasks references unknown task "${orphan}".`,
      );
    }

    // Linearize on the version increment
    const nextVersion = stream.currentPlanVersion + 1;
    const linearized = await this.streams
      .findOneAndUpdate(
        { _id: stream._id, currentPlanVersion: stream.currentPlanVersion },
        { $inc: { currentPlanVersion: 1 }, $set: { lastActivityAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!linearized) {
      throw new ConflictException(
        ErrorCode.WORKY_STALE_PLAN_VERSION,
        'A concurrent plan-delta was applied; refetch the latest plan and retry.',
      );
    }

    // Apply
    const createdTaskIds: string[] = [];
    const updatedTaskIds: string[] = [];
    const cancelledTaskIds: string[] = [];
    for (const c of body.create_tasks ?? []) {
      const created = await this.tasks.create({
        streamId: stream._id,
        title: c.title,
        description: c.description ?? '',
        lane: c.lane,
        planningStatus: c.planningStatus ?? 'confirmed',
        executionState: 'not_started',
        controlState: 'active',
        priority: c.priority ?? 'medium',
        assigneeType: c.assigneeType ?? 'ephemeral_ai_agent',
        assigneeId: null,
        dependsOn: (c.dependsOn ?? []).map((ref) => this.resolveRef(ref, clientIdMap)),
        requiredTools: c.requiredTools ?? [],
        actionCategory: c.actionCategory,
        acceptanceCriteria: c.acceptanceCriteria ?? [],
        budget: {
          estimateUsd: c.budgetEstimateUsd ?? 0,
          actualUsd: 0,
          tokensEstimate: c.tokensEstimate ?? 0,
          tokensActual: 0,
        },
        waitConditions: [],
      });
      const id = (created._id as Types.ObjectId).toString();
      if (c.clientTaskId) clientIdMap.set(c.clientTaskId, created._id as Types.ObjectId);
      createdTaskIds.push(id);
    }
    // Human assignment hook (Part 4 §3.1). For each created task with
    // `assigneeType='human_agent'` and an `assigneeHint`, resolve the
    // workspace user. Unique match → set `assigneeId`, send email,
    // schedule reminders, share workspace. Ambiguous / no match → roll
    // the task back to `unassigned` and raise a clarification.
    const humanClarificationBlocks: Array<{ taskId: string; title: string }> = [];
    for (let i = 0; i < (body.create_tasks ?? []).length; i += 1) {
      const c = (body.create_tasks ?? [])[i];
      const taskId = createdTaskIds[i];
      if (c.assigneeType !== 'human_agent' || !c.assigneeHint || !taskId) continue;
      const result = await this.humanAssignment.assignFromHint({
        streamId: input.streamId,
        taskId,
        hint: c.assigneeHint,
      });
      if (result.status === 'unresolved' || result.status === 'ambiguous') {
        // Roll the task back to `unassigned` so it doesn't sit with a
        // misleading `human_agent` type while the owner resolves.
        await this.tasks
          .updateOne(
            { _id: new Types.ObjectId(taskId) },
            { $set: { assigneeType: 'unassigned', assigneeId: null, theoreticalDeadlineAt: null } },
          )
          .exec();
        humanClarificationBlocks.push({ taskId, title: c.title });
      }
    }
    for (const block of humanClarificationBlocks) {
      await this.interactions.create({
        streamId: stream._id,
        taskId: new Types.ObjectId(block.taskId),
        type: 'assignment_disambiguation',
        targetUserId: stream.ownerUserId,
        question: `Who should be assigned to "${block.title}"? Please clarify or invite the user.`,
        options: [],
        status: 'pending',
        blockingScope: 'task',
        blocksTaskIds: [new Types.ObjectId(block.taskId)],
        respondedAt: null,
        response: null,
      });
    }
    for (const u of body.update_tasks ?? []) {
      const ref = this.resolveRef(u.taskId, clientIdMap);
      const update: Record<string, unknown> = {};
      if (u.title !== undefined) update.title = u.title;
      if (u.description !== undefined) update.description = u.description;
      if (u.lane !== undefined) update.lane = u.lane;
      if (u.priority !== undefined) update.priority = u.priority;
      if (u.assigneeType !== undefined) update.assigneeType = u.assigneeType;
      if (u.actionCategory !== undefined) update.actionCategory = u.actionCategory;
      if (u.acceptanceCriteria !== undefined) update.acceptanceCriteria = u.acceptanceCriteria;
      if (u.dependsOn !== undefined) {
        update.dependsOn = u.dependsOn.map((ref2) => this.resolveRef(ref2, clientIdMap));
      }
      if (Object.keys(update).length === 0) continue;
      const updated = await this.tasks
        .findOneAndUpdate({ _id: ref, streamId: stream._id }, { $set: update }, { new: true })
        .exec();
      if (updated) updatedTaskIds.push((updated._id as Types.ObjectId).toString());
    }
    for (const c of body.cancel_tasks ?? []) {
      const ref = this.resolveRef(c.taskId, clientIdMap);
      const cancelled = await this.tasks
        .findOneAndUpdate(
          { _id: ref, streamId: stream._id },
          { $set: { lane: 'canceled', controlState: 'stopped', executionState: 'canceled' } },
          { new: true },
        )
        .exec();
      if (cancelled) cancelledTaskIds.push((cancelled._id as Types.ObjectId).toString());
    }

    // Clarifications: persist as `WorkyInteraction` rows so the board
    // projection can mark the referenced tasks as `blocked`. The
    // `blocksTaskIds` are resolved from the `clientTaskId` mapping
    // populated above.
    const clarificationIds: string[] = [];
    for (const c of body.clarification_requests ?? []) {
      const blocks: Types.ObjectId[] = [];
      for (const ref of c.blocksTaskClientIds ?? []) {
        try {
          blocks.push(this.resolveRef(ref, clientIdMap));
        } catch {
          // missing refs are dropped — the spec doesn't require us to
          // reject the whole delta over a dangling block.
        }
      }
      for (const id of c.blocksTaskIds ?? []) {
        if (Types.ObjectId.isValid(id)) blocks.push(new Types.ObjectId(id));
      }
      const created = await this.interactions.create({
        streamId: stream._id,
        taskId: blocks[0] ?? null,
        type: c.type ?? 'clarification',
        targetUserId: stream.ownerUserId,
        question: c.question,
        options: c.options ?? [],
        status: 'pending',
        blockingScope: 'task',
        blocksTaskIds: blocks,
        respondedAt: null,
        response: null,
      });
      clarificationIds.push((created._id as Types.ObjectId).toString());
    }

    // Persist the delta
    const delta = await this.planDeltas.create({
      streamId: stream._id,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: nextVersion,
      phase: input.phase,
      triggerEventId: input.triggerEventId,
      status: 'applied',
      applyMode: input.applyMode ?? 'auto',
      reason: '',
      createdBy: new Types.ObjectId(input.createdBy),
      body: this.bodyToWire(body),
    });
    await this.planVersions.create({
      streamId: stream._id,
      versionNumber: nextVersion,
      phase: input.phase,
      createdBy: new Types.ObjectId(input.createdBy),
      createdFromMessageId: null,
      triggerEventId: input.triggerEventId,
      summary: this.summarizeDelta(
        createdTaskIds.length,
        updatedTaskIds.length,
        cancelledTaskIds.length,
        clarificationIds.length,
      ),
    });
    this.logger.log('Worky plan-delta applied', {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: nextVersion,
      deltaId: (delta._id as Types.ObjectId).toString(),
      createdTaskIds: createdTaskIds.length,
      updatedTaskIds: updatedTaskIds.length,
      cancelledTaskIds: cancelledTaskIds.length,
      clarificationIds: clarificationIds.length,
    });
    return {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: nextVersion,
      planDeltaId: (delta._id as Types.ObjectId).toString(),
      createdTaskIds,
      updatedTaskIds,
      cancelledTaskIds,
      clarificationIds,
    };
  }

  private isPreExecutionPhase(status: string): boolean {
    // `start_validation_failed` is a pre-execution status: Start
    // Stream ran while the plan was empty, so the owner needs to
    // keep conversing with the Manager to add tasks. Without this
    // the plan-delta path would reject the follow-up delta with
    // ERR_3409 and the stream is dead-ended.
    return (
      status === 'created' ||
      status === 'planning' ||
      status === 'start_validation_failed'
    );
  }

  private isTerminalPhase(status: string): boolean {
    return (
      status === 'completed' || status === 'stopped' || status === 'archived'
    );
  }

  /**
   * Consult governance for each op in the delta. Returns
   * `{ requiresApproval: true, blockingCategories: string[] }` when
   * any op touches an `approval` or `hard_block` category, or when
   * `applyMode='manual'`. Auto-mode + only-off/notify categories
   * returns `{ requiresApproval: false }` (canonical §17.4).
   */
  private async evaluateReplanGuard(
    streamId: string,
    body: IPlanDeltaBody,
    applyMode: 'auto' | 'manual',
  ): Promise<{ requiresApproval: boolean; blockingCategories: string[] }> {
    if (applyMode === 'manual') {
      return { requiresApproval: true, blockingCategories: ['manual_mode'] };
    }
    const categories = new Set<string>();
    for (const c of body.create_tasks ?? []) categories.add(c.actionCategory);
    for (const u of body.update_tasks ?? []) {
      if (u.actionCategory) categories.add(u.actionCategory);
    }
    for (const c of body.cancel_tasks ?? []) {
      // Cancellations of not-started tasks are always safe. Cancellations
      // of running or done tasks fall under `cancel_human_task` / `replanning`.
      categories.add('replanning');
    }
    const blocking: string[] = [];
    for (const category of categories) {
      const result = await this.governance.resolve(streamId, category, null);
      if (result.resolvedLevel === 'approval' || result.resolvedLevel === 'hard_block') {
        blocking.push(category);
      }
    }
    return {
      requiresApproval: blocking.length > 0,
      blockingCategories: blocking,
    };
  }

  private isEmpty(body: IPlanDeltaBody): boolean {
    return (
      (body.create_tasks?.length ?? 0) === 0 &&
      (body.update_tasks?.length ?? 0) === 0 &&
      (body.cancel_tasks?.length ?? 0) === 0 &&
      (body.clarification_requests?.length ?? 0) === 0
    );
  }

  private async persistEmptyDelta(
    stream: WorkyStreamDocument,
    input: PlanDeltaApplyInput & { phase: 'planning' | 'replan'; applyMode: 'auto' | 'manual' | 'pending_approval' },
    body: IPlanDeltaBody,
  ): Promise<IPlanDeltaApplyResult> {
    const delta = await this.planDeltas.create({
      streamId: stream._id,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: stream.currentPlanVersion,
      phase: input.phase,
      triggerEventId: input.triggerEventId,
      status: 'applied',
      applyMode: input.applyMode ?? 'auto',
      reason: 'empty delta',
      createdBy: new Types.ObjectId(input.createdBy),
      body: this.bodyToWire(body),
    });
    return {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: stream.currentPlanVersion,
      planDeltaId: (delta._id as Types.ObjectId).toString(),
      createdTaskIds: [],
      updatedTaskIds: [],
      cancelledTaskIds: [],
      clarificationIds: [],
    };
  }

  private resolveClientTaskIds(
    body: IPlanDeltaBody,
    existingIds: Set<string>,
  ): { cycle: boolean; missingRefs: string[]; orphans: string[] } {
    // Graph validation: (1) every dependsOn ref must resolve to either an
    // existing task id or the clientTaskId of another `create_tasks` entry
    // in this delta; (2) cycle detection on the new subgraph only (existing
    // tasks are frozen from prior versions).
    const newClientIds = new Set<string>(
      (body.create_tasks ?? []).map((c) => c.clientTaskId).filter((x): x is string => !!x),
    );
    const missingRefs: string[] = [];
    const clientToIndex = new Map<string, number>();
    (body.create_tasks ?? []).forEach((c, i) => {
      if (c.clientTaskId) clientToIndex.set(c.clientTaskId, i);
    });
    // Build the new-task dependency graph. Edge `a -> b` means a depends on b.
    const adjacency: number[][] = (body.create_tasks ?? []).map(() => []);
    const indegree = new Array<number>(body.create_tasks?.length ?? 0).fill(0);
    for (let i = 0; i < (body.create_tasks?.length ?? 0); i++) {
      const c = body.create_tasks![i]!;
      for (const ref of c.dependsOn ?? []) {
        if (existingIds.has(ref)) continue; // existing tasks are not in the new-subgraph topo
        const targetIdx = clientToIndex.get(ref);
        if (targetIdx === undefined) {
          missingRefs.push(ref);
          continue;
        }
        adjacency[i]!.push(targetIdx);
        indegree[targetIdx] = (indegree[targetIdx] ?? 0) + 1;
      }
    }
    for (const u of body.update_tasks ?? []) {
      if (!Types.ObjectId.isValid(u.taskId) || !existingIds.has(u.taskId)) {
        missingRefs.push(u.taskId);
      }
    }
    for (const c of body.cancel_tasks ?? []) {
      if (!Types.ObjectId.isValid(c.taskId) || !existingIds.has(c.taskId)) {
        missingRefs.push(c.taskId);
      }
    }
    // Kahn's algorithm on the new-subgraph only.
    const queue: number[] = [];
    for (let i = 0; i < indegree.length; i++) {
      if (indegree[i] === 0) queue.push(i);
    }
    let visited = 0;
    while (queue.length > 0) {
      const i = queue.shift()!;
      visited++;
      for (const next of adjacency[i]!) {
        indegree[next]! -= 1;
        if (indegree[next] === 0) queue.push(next);
      }
    }
    const cycle = visited < (body.create_tasks?.length ?? 0);
    return {
      cycle,
      missingRefs: Array.from(new Set(missingRefs)),
      orphans: [],
    };
  }

  private resolveRef(
    ref: string,
    clientIdMap: Map<string, Types.ObjectId>,
  ): Types.ObjectId {
    if (Types.ObjectId.isValid(ref)) return new Types.ObjectId(ref);
    const mapped = clientIdMap.get(ref);
    if (!mapped) {
      throw new BadRequestException(
        ErrorCode.WORKY_INVALID_PLAN_DELTA,
        `Cannot resolve task ref "${ref}".`,
      );
    }
    return mapped;
  }

  private bodyToWire(body: IPlanDeltaBody): Record<string, unknown> {
    return {
      create_tasks: body.create_tasks ?? [],
      update_tasks: body.update_tasks ?? [],
      cancel_tasks: body.cancel_tasks ?? [],
      clarification_requests: body.clarification_requests ?? [],
    };
  }

  private summarizeDelta(
    created: number,
    updated: number,
    cancelled: number,
    clarifications: number,
  ): string {
    const parts: string[] = [];
    if (created) parts.push(`+${created} task${created === 1 ? '' : 's'}`);
    if (updated) parts.push(`~${updated} task${updated === 1 ? '' : 's'}`);
    if (cancelled) parts.push(`-${cancelled} task${cancelled === 1 ? '' : 's'}`);
    if (clarifications) parts.push(`?${clarifications} clarification${clarifications === 1 ? '' : 's'}`);
    return parts.length === 0 ? 'empty delta' : parts.join(', ');
  }

  /**
   * Normalize the validated DTO body into the wire shape used everywhere
   * downstream. Empty arrays are filled so downstream code can iterate
   * without optional chaining.
   */
  private normalizeBody(body: PlanDeltaBodyDto): IPlanDeltaBody {
    return {
      create_tasks: body.create_tasks ?? [],
      update_tasks: body.update_tasks ?? [],
      cancel_tasks: body.cancel_tasks ?? [],
      clarification_requests: body.clarification_requests ?? [],
    };
  }
}
