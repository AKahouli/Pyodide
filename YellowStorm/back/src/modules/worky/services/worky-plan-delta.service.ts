import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, normalizeObjectId, withTransaction } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository, type WorkyTaskPatch } from '../persistence/worky-task.repository';
import { WorkyPlanRepository } from '../persistence/worky-plan.repository';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import type { WorkyStreamRecord } from '../worky.types';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PlanDeltaBodyDto } from '../dto/plan-delta-body.dto';
import {
  IPlanDeltaApplyResult,
  IPlanDeltaBody,
  IPlanDeltaCreateTask,
} from '../interfaces/plan-delta.interface';
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
 *   5. Atomic apply — every write of one delta runs in one transaction.
 *   6. Versioning — create a plan version row and link the delta.
 *
 * The conditional version increment (`advancePlanVersion`) is the
 * linearization point: a concurrent caller that raced to this point gets a
 * `stale_base_version` 409 and its transaction writes nothing.
 *
 * The human-assignment hook sends mail and schedules timers, which a
 * rollback could not take back, so it runs after the commit.
 *
 * Cancel operations set `lane='canceled'`; create / update use the lane
 * supplied by the runtime. System lanes (`failed|canceled|...`) are not
 * in the `BOARD_LANES` projection, so the board does not show them.
 */
@Injectable()
export class WorkyPlanDeltaService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly plans: WorkyPlanRepository,
    private readonly interactions: WorkyInteractionRepository,
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
    const stream = await this.streams.findById(input.streamId);
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
    const guard = await this.evaluateReplanGuard(stream.id, body, input.applyMode);
    if (guard.requiresApproval) {
      const { delta, interaction } = await withTransaction(this.db, async () => {
        const delta = await this.plans.createDelta({
          streamId: stream.id,
          basePlanVersion: input.basePlanVersion,
          resultPlanVersion: stream.currentPlanVersion,
          phase: 'replan',
          triggerEventId: input.triggerEventId,
          status: 'pending_approval',
          applyMode: input.applyMode,
          reason: input.reason,
          createdBy: input.createdBy,
          body: this.bodyToWire(body),
        });
        const interaction = await this.interactions.create({
          streamId: stream.id,
          taskId: null,
          type: 'replan_review',
          targetUserId: stream.ownerUserId,
          question: `A dynamic replan was triggered${input.reason ? ` (${input.reason})` : ''}. Touches categories: ${guard.blockingCategories.join(', ')}. Approve to apply.`,
          options: ['approve', 'reject'],
          blockingScope: 'stream',
          blocksTaskIds: [],
          metadata: { planDeltaId: delta.id },
        });
        return { delta, interaction };
      });
      this.events.emit(stream.ownerUserId, stream.id, {
        type: 'replan.approval_required',
        emittedAt: Date.now(),
        payload: {
          planDeltaId: delta.id,
          blockingCategories: guard.blockingCategories,
          reason: input.reason,
        },
      });
      this.events.emit(stream.ownerUserId, stream.id, {
        type: 'replan.required',
        emittedAt: Date.now(),
        payload: {
          planDeltaId: delta.id,
          reason: input.reason,
          mode: input.applyMode,
        },
      });
      return {
        status: 'pending_approval',
        planDeltaId: delta.id,
        blockingCategories: guard.blockingCategories,
        reason: input.reason,
        interactionId: interaction.id,
      };
    }
    const result = await this.applyInternal({
      ...input,
      phase: 'replan',
      applyMode: 'auto',
    });
    this.events.emit(stream.ownerUserId, stream.id, {
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
    const delta = await this.plans.findDeltaById(input.planDeltaId);
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
        resultPlanVersion: delta.resultPlanVersion ?? 0,
      };
    }
    if (delta.status !== 'pending_approval') {
      return {
        status: 'rejected',
        planDeltaId: input.planDeltaId,
      };
    }
    const result = await this.applyInternal({
      streamId: delta.streamId,
      basePlanVersion: delta.basePlanVersion,
      triggerEventId: delta.triggerEventId,
      body: delta.body as unknown as PlanDeltaBodyDto,
      createdBy: input.approvedBy,
      phase: 'replan',
      applyMode: 'pending_approval',
    });
    await this.plans.markApplied(input.planDeltaId, {
      resultPlanVersion: result.resultPlanVersion,
      approvedBy: input.approvedBy,
    });
    const streamForEvent = await this.streams.findById(delta.streamId);
    const ownerUserId = streamForEvent?.ownerUserId ?? '';
    this.events.emit(ownerUserId, delta.streamId, {
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
    const stream = await this.streams.findById(input.streamId);
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
    const existingIds = new Set(await this.tasks.listIdsByStream(stream.id));
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

    const nextVersion = stream.currentPlanVersion + 1;
    const applied = await withTransaction(this.db, async () => {
      // Linearize on the version increment
      const linearized = await this.streams.advancePlanVersion(stream.id, stream.currentPlanVersion);
      if (!linearized) {
        throw new ConflictException(
          ErrorCode.WORKY_STALE_PLAN_VERSION,
          'A concurrent plan-delta was applied; refetch the latest plan and retry.',
        );
      }

      // Apply
      const clientIdMap = new Map<string, string>();
      const createdTaskIds: string[] = [];
      const updatedTaskIds: string[] = [];
      const cancelledTaskIds: string[] = [];
      for (const c of body.create_tasks ?? []) {
        const created = await this.tasks.create({
          streamId: stream.id,
          title: c.title,
          description: c.description ?? '',
          lane: c.lane,
          planningStatus: c.planningStatus ?? 'confirmed',
          priority: c.priority ?? 'medium',
          assigneeType: c.assigneeType ?? 'ephemeral_ai_agent',
          dependsOn: (c.dependsOn ?? []).map((ref) => this.resolveRef(ref, clientIdMap)),
          requiredTools: c.requiredTools ?? [],
          actionCategory: c.actionCategory,
          acceptanceCriteria: c.acceptanceCriteria ?? [],
          budgetEstimateUsd: c.budgetEstimateUsd ?? 0,
          tokensEstimate: c.tokensEstimate ?? 0,
        });
        if (c.clientTaskId) clientIdMap.set(c.clientTaskId, created.id);
        createdTaskIds.push(created.id);
      }
      for (const u of body.update_tasks ?? []) {
        const ref = this.resolveRef(u.taskId, clientIdMap);
        const update: WorkyTaskPatch = {};
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
        const updated = await this.tasks.updateInStream(ref, stream.id, update);
        if (updated) updatedTaskIds.push(updated.id);
      }
      for (const c of body.cancel_tasks ?? []) {
        const ref = this.resolveRef(c.taskId, clientIdMap);
        const cancelled = await this.tasks.updateInStream(ref, stream.id, {
          lane: 'canceled',
          controlState: 'stopped',
          executionState: 'canceled',
        });
        if (cancelled) cancelledTaskIds.push(cancelled.id);
      }

      // Clarifications: persist as interaction rows so the board
      // projection can mark the referenced tasks as `blocked`. The
      // `blocksTaskIds` are resolved from the `clientTaskId` mapping
      // populated above.
      const streamTaskIds = new Set([...existingIds, ...createdTaskIds]);
      const clarificationIds: string[] = [];
      for (const c of body.clarification_requests ?? []) {
        const blocks: string[] = [];
        for (const ref of c.blocksTaskClientIds ?? []) {
          try {
            blocks.push(this.resolveRef(ref, clientIdMap));
          } catch {
            // missing refs are dropped — the spec doesn't require us to
            // reject the whole delta over a dangling block.
          }
        }
        for (const id of c.blocksTaskIds ?? []) {
          if (isObjectId(id)) blocks.push(normalizeObjectId(id));
        }
        const created = await this.interactions.create({
          streamId: stream.id,
          // task_id is a foreign key (blocksTaskIds is not): the first blocked task of this stream.
          taskId: blocks.find((id) => streamTaskIds.has(id)) ?? null,
          type: c.type ?? 'clarification',
          targetUserId: stream.ownerUserId,
          question: c.question,
          options: c.options ?? [],
          blockingScope: 'task',
          blocksTaskIds: blocks,
        });
        clarificationIds.push(created.id);
      }

      // Persist the delta
      const delta = await this.plans.createDelta({
        streamId: stream.id,
        basePlanVersion: input.basePlanVersion,
        resultPlanVersion: nextVersion,
        phase: input.phase,
        triggerEventId: input.triggerEventId,
        status: 'applied',
        applyMode: input.applyMode ?? 'auto',
        reason: '',
        createdBy: input.createdBy,
        body: this.bodyToWire(body),
      });
      await this.plans.createVersion({
        streamId: stream.id,
        versionNumber: nextVersion,
        phase: input.phase,
        createdBy: input.createdBy,
        createdFromMessageId: null,
        triggerEventId: input.triggerEventId,
        summary: this.summarizeDelta(
          createdTaskIds.length,
          updatedTaskIds.length,
          cancelledTaskIds.length,
          clarificationIds.length,
        ),
      });
      return { planDeltaId: delta.id, createdTaskIds, updatedTaskIds, cancelledTaskIds, clarificationIds };
    });

    await this.assignHumans(stream, body.create_tasks ?? [], applied.createdTaskIds);

    this.logger.log('Worky plan-delta applied', {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: nextVersion,
      deltaId: applied.planDeltaId,
      createdTaskIds: applied.createdTaskIds.length,
      updatedTaskIds: applied.updatedTaskIds.length,
      cancelledTaskIds: applied.cancelledTaskIds.length,
      clarificationIds: applied.clarificationIds.length,
    });
    return {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: nextVersion,
      planDeltaId: applied.planDeltaId,
      createdTaskIds: applied.createdTaskIds,
      updatedTaskIds: applied.updatedTaskIds,
      cancelledTaskIds: applied.cancelledTaskIds,
      clarificationIds: applied.clarificationIds,
    };
  }

  /**
   * Human assignment hook (Part 4 §3.1), after the delta committed. For
   * each created task with `assigneeType='human_agent'` and an
   * `assigneeHint`, resolve the workspace user. Unique match → set
   * `assigneeId`, send email, schedule reminders, share workspace.
   * Ambiguous / no match → roll the task back to `unassigned` and raise a
   * clarification.
   */
  private async assignHumans(
    stream: WorkyStreamRecord,
    creates: IPlanDeltaCreateTask[],
    createdTaskIds: string[],
  ): Promise<void> {
    for (let i = 0; i < creates.length; i += 1) {
      const c = creates[i];
      const taskId = createdTaskIds[i];
      if (c.assigneeType !== 'human_agent' || !c.assigneeHint || !taskId) continue;
      const result = await this.humanAssignment.assignFromHint({
        streamId: stream.id,
        taskId,
        hint: c.assigneeHint,
      });
      if (result.status !== 'unresolved' && result.status !== 'ambiguous') continue;
      // Roll the task back to `unassigned` so it doesn't sit with a
      // misleading `human_agent` type while the owner resolves.
      await withTransaction(this.db, async () => {
        await this.tasks.update(taskId, {
          assigneeType: 'unassigned',
          assigneeId: null,
          theoreticalDeadlineAt: null,
        });
        await this.interactions.create({
          streamId: stream.id,
          taskId,
          type: 'assignment_disambiguation',
          targetUserId: stream.ownerUserId,
          question: `Who should be assigned to "${c.title}"? Please clarify or invite the user.`,
          options: [],
          blockingScope: 'task',
          blocksTaskIds: [taskId],
        });
      });
    }
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
    stream: WorkyStreamRecord,
    input: PlanDeltaApplyInput & { phase: 'planning' | 'replan'; applyMode: 'auto' | 'manual' | 'pending_approval' },
    body: IPlanDeltaBody,
  ): Promise<IPlanDeltaApplyResult> {
    const delta = await this.plans.createDelta({
      streamId: stream.id,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: stream.currentPlanVersion,
      phase: input.phase,
      triggerEventId: input.triggerEventId,
      status: 'applied',
      applyMode: input.applyMode ?? 'auto',
      reason: 'empty delta',
      createdBy: input.createdBy,
      body: this.bodyToWire(body),
    });
    return {
      streamId: input.streamId,
      basePlanVersion: input.basePlanVersion,
      resultPlanVersion: stream.currentPlanVersion,
      planDeltaId: delta.id,
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
      if (!isObjectId(u.taskId) || !existingIds.has(u.taskId)) {
        missingRefs.push(u.taskId);
      }
    }
    for (const c of body.cancel_tasks ?? []) {
      if (!isObjectId(c.taskId) || !existingIds.has(c.taskId)) {
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
    clientIdMap: Map<string, string>,
  ): string {
    if (isObjectId(ref)) return normalizeObjectId(ref);
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
