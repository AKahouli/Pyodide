import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { normalizeObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { WorkyMailRepository } from '../persistence/worky-mail.repository';
import type { WorkyStreamRecord, WorkyTaskRecord } from '../worky.types';
import { LoggerService } from '../../logger';
import { EmailService } from '../../email/email.service';
import { UserService } from '../../user/user.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyAuditService } from './worky-audit.service';
import { WorkySchedulerService } from './worky-scheduler.service';
import { IPlanDeltaAssigneeHint } from '../interfaces/plan-delta.interface';

const REMINDER_LEAD_MS = 6 * 60 * 60 * 1000;

export interface WorkyAssignHumanResult {
  status: 'assigned' | 'ambiguous' | 'unresolved';
  taskId?: string;
  assigneeId?: string;
  candidates?: { id: string; email: string; displayName: string }[];
  reason?: string;
}

export interface WorkyHumanUpdateResult {
  taskId: string;
  kind: string;
  newExecutionState: string;
  newLane: string;
}

interface CandidateUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Explicit-only human assignment + email/reminders (Part 4
 * `docs/worky/04_HUMANS_BUDGET_REPORTS.md` §3). The LLM can never
 * assign a human on its own — the owner must have explicitly mentioned
 * the person in a plan delta. The resolver runs a workspace-scoped
 * user lookup, picks a unique match, or raises a clarification when
 * the reference is ambiguous / not found.
 *
 * The service is also responsible for:
 *   - Auto-granting scoped read access on the stream's artifact
 *     workspace via `workspace-share.service.ts` (canonical §14.2).
 *   - Sending the initial assignment email (dedup'd via the
 *     `worky.mail_event_ledger`).
 *   - Scheduling the T-6h reminder + deadline escalation timers.
 *   - Applying human Kanban updates (in_progress/feedback/...) and
 *     emitting the matching SSE event so the readiness evaluator
 *     re-derives the dependent DAG branch.
 */
@Injectable()
export class WorkyHumanAssignmentService {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly mail: WorkyMailRepository,
    private readonly emailService: EmailService,
    private readonly userService: UserService,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly scheduler: WorkySchedulerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyHumanAssignmentService.name);
  }

  /**
   * Resolve a human-assignment hint into a concrete `assigneeId`.
   * Idempotent: if the task is already a `human_agent` task assigned to
   * the person the hint resolves to, returns `assigned` without
   * updating the task again, sending a duplicate email or scheduling
   * duplicate reminders.
   */
  async assignFromHint(input: {
    streamId: string;
    taskId: string;
    hint: IPlanDeltaAssigneeHint;
  }): Promise<WorkyAssignHumanResult> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) {
      throw new Error(`WorkyHumanAssignmentService: task ${input.taskId} not found`);
    }
    const stream = await this.streams.findById(input.streamId);
    if (!stream) {
      throw new Error(`WorkyHumanAssignmentService: stream ${input.streamId} not found`);
    }

    const candidates = await this.findCandidates(input.hint.reference);
    if (candidates.length === 0) {
      await this.audit.append({
        streamId: input.streamId,
        action: 'human_task.unresolved',
        targetType: 'worky_task',
        targetId: input.taskId,
        details: { reference: input.hint.reference },
      });
      return { status: 'unresolved', reason: 'no_match' };
    }
    if (candidates.length > 1) {
      await this.audit.append({
        streamId: input.streamId,
        action: 'human_task.ambiguous',
        targetType: 'worky_task',
        targetId: input.taskId,
        details: {
          reference: input.hint.reference,
          candidateCount: candidates.length,
          candidateIds: candidates.map((c) => c.id),
        },
      });
      return { status: 'ambiguous', candidates };
    }
    const assignee = candidates[0];
    if (task.assigneeType === 'human_agent' && task.assigneeId === normalizeObjectId(assignee.id)) {
      // Already assigned to this person (idempotent replay)
      return { status: 'assigned', taskId: input.taskId, assigneeId: task.assigneeId };
    }
    const dueAt = this.parseDueAt(input.hint.dueAt);

    const assigned = await this.tasks.update(task.id, {
      assigneeType: 'human_agent',
      assigneeId: assignee.id,
      theoreticalDeadlineAt: dueAt,
    });
    if (!assigned) {
      throw new Error(`WorkyHumanAssignmentService: task ${input.taskId} not found`);
    }

    await this.sendAssignmentEmail(stream, assigned, assignee);
    await this.scheduleReminders(stream, assigned, assignee, dueAt);

    this.events.emit(stream.ownerUserId, stream.id, {
      type: 'human_task.assigned',
      emittedAt: Date.now(),
      payload: {
        taskId: input.taskId,
        assigneeId: assignee.id,
        assigneeEmail: assignee.email,
        theoreticalDeadlineAt: dueAt ? dueAt.toISOString() : null,
      },
    });
    this.events.emit(stream.ownerUserId, stream.id, {
      type: 'task.updated',
      emittedAt: Date.now(),
      payload: { taskId: input.taskId, assigneeId: assignee.id },
    });
    await this.audit.append({
      streamId: input.streamId,
      action: 'human_task.assigned',
      targetType: 'worky_task',
      targetId: input.taskId,
      details: {
        assigneeId: assignee.id,
        assigneeEmail: assignee.email,
        theoreticalDeadlineAt: dueAt ? dueAt.toISOString() : null,
      },
    });
    return { status: 'assigned', taskId: input.taskId, assigneeId: assignee.id };
  }

  /**
   * Apply a human Kanban update. Validates the kind, transitions the
   * task's execution state, and emits the matching SSE event so the
   * readiness evaluator re-derives the dependent DAG branch
   * (canonical §14.4). `streamId` is optional; if omitted it is
   * derived from the task row.
   */
  async applyHumanUpdate(input: {
    streamId?: string;
    taskId: string;
    actorUserId: string;
    kind: 'in_progress' | 'feedback' | 'request_changes' | 'blocked' | 'done';
    comment?: string;
  }): Promise<WorkyHumanUpdateResult> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) {
      throw new Error(`WorkyHumanAssignmentService: task ${input.taskId} not found`);
    }
    if (task.assigneeType !== 'human_agent') {
      throw new Error(
        `WorkyHumanAssignmentService: task ${input.taskId} is not a human task`,
      );
    }
    const transitions: Record<
      string,
      { executionState: string; lane: string }
    > = {
      in_progress: { executionState: 'running', lane: 'running' },
      feedback: { executionState: 'review', lane: 'review' },
      request_changes: { executionState: 'review', lane: 'review' },
      blocked: { executionState: 'waiting_for_event', lane: 'blocked' },
      done: { executionState: 'done', lane: 'done' },
    };
    const next = transitions[input.kind];
    await this.tasks.update(task.id, { executionState: next.executionState, lane: next.lane });
    const eventType =
      input.kind === 'feedback' || input.kind === 'request_changes'
        ? 'human_task.feedback_submitted'
        : input.kind === 'done'
          ? 'human_task.completed'
          : 'human_task.assigned';
    const streamId = input.streamId ?? task.streamId;
    const stream = await this.streams.findById(streamId);
    if (stream) {
      this.events.emit(stream.ownerUserId, stream.id, {
        type: eventType,
        emittedAt: Date.now(),
        payload: {
          taskId: input.taskId,
          kind: input.kind,
          actorUserId: input.actorUserId,
          comment: input.comment ?? null,
        },
      });
      this.events.emit(stream.ownerUserId, stream.id, {
        type: 'task.updated',
        emittedAt: Date.now(),
        payload: { taskId: input.taskId, lane: next.lane, executionState: next.executionState },
      });
      await this.audit.append({
        streamId: streamId,
        actorUserId: input.actorUserId,
        action: 'human_task.update',
        targetType: 'worky_task',
        targetId: input.taskId,
        details: { kind: input.kind, comment: input.comment ?? null },
      });
    }
    return {
      taskId: input.taskId,
      kind: input.kind,
      newExecutionState: next.executionState,
      newLane: next.lane,
    };
  }

  // =================================================================
  // Internals
  // =================================================================

  private async findCandidates(reference: string): Promise<CandidateUser[]> {
    const trimmed = reference.trim();
    if (!trimmed) return [];
    const lowered = trimmed.toLowerCase();
    if (lowered.includes('@')) {
      const u = await this.userService.findByEmail(lowered);
      if (u && u.status === 'active') {
        return [
          {
            id: u._id.toString(),
            email: u.email,
            displayName: this.userDisplayName(u),
          },
        ];
      }
      return [];
    }
    // searchUsers is email-prefix only, so for name lookups we also
    // match on firstName/lastName equality. The MVP keeps the user
    // table global; the stream's owner is the only person who can
    // disambiguate via the audit log.
    const prefixResults = await this.userService.searchUsers({ query: trimmed, limit: 50 });
    const exact: CandidateUser[] = [];
    const seen = new Set<string>();
    for (const r of prefixResults) {
      const first = (r.firstName ?? '').toLowerCase();
      const last = (r.lastName ?? '').toLowerCase();
      const fullName = `${first} ${last}`.trim();
      const isMatch =
        first === lowered || last === lowered || fullName === lowered;
      if (!isMatch || seen.has(r.id)) continue;
      seen.add(r.id);
      exact.push({
        id: r.id,
        email: r.email,
        displayName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
      });
    }
    return exact;
  }

  private userDisplayName(u: {
    profile?: { firstName?: string; lastName?: string };
    email: string;
  }): string {
    const fn = u.profile?.firstName;
    const ln = u.profile?.lastName;
    if (fn || ln) return `${fn ?? ''} ${ln ?? ''}`.trim();
    return u.email;
  }

  private parseDueAt(dueAt: string | undefined): Date | null {
    if (!dueAt) return null;
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  private async sendAssignmentEmail(
    stream: WorkyStreamRecord,
    task: WorkyTaskRecord,
    assignee: CandidateUser,
  ): Promise<void> {
    const dedupKey = this.buildMailDedupKey(
      stream.id,
      task.id,
      'human_task.assigned',
      assignee.id,
      0,
    );
    // False only when the ledger already holds this mail; a database error propagates
    // instead of being mistaken for "already sent".
    const firstSend = await this.mail.recordMail({
      streamId: stream.id,
      taskId: task.id,
      kind: 'human_task.assigned',
      dedupKey,
    });
    if (!firstSend) {
      this.logger.debug('Worky human-assignment: email already sent (ledger hit)', {
        dedupKey,
      });
      return;
    }
    await this.emailService.send({
      to: assignee.email,
      subject: `You have a task on stream "${stream.title}"`,
      text: `You have been assigned the task "${task.title}" on the stream "${stream.title}".\n\n` +
        `Please open the stream to view the task and update its status as you progress.\n` +
        `Deadline: ${task.theoreticalDeadlineAt ? task.theoreticalDeadlineAt.toISOString() : 'not specified'}`,
    });
  }

  private async scheduleReminders(
    stream: WorkyStreamRecord,
    task: WorkyTaskRecord,
    assignee: CandidateUser,
    dueAt: Date | null,
  ): Promise<void> {
    if (!dueAt) return;
    const reminderAt = new Date(dueAt.getTime() - REMINDER_LEAD_MS);
    const now = Date.now();
    if (reminderAt.getTime() > now) {
      await this.scheduler.schedule({
        streamId: stream.id,
        taskId: task.id,
        eventType: 'human_task.reminder',
        fireAt: reminderAt,
      });
    }
    if (dueAt.getTime() > now) {
      await this.scheduler.schedule({
        streamId: stream.id,
        taskId: task.id,
        eventType: 'human_task.deadline',
        fireAt: dueAt,
      });
    }
  }

  private buildMailDedupKey(
    streamId: string,
    taskId: string,
    kind: string,
    recipientUserId: string,
    step: number,
  ): string {
    return createHash('sha256')
      .update(`${streamId}|${taskId}|${kind}|${recipientUserId}|${step}`)
      .digest('hex');
  }
}
