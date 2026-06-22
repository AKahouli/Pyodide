import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { WorkyEventService } from './worky-event.service';
import { WorkyRuntimeClient, WorkyRuntimeFrame, WorkyRuntimeSseResult, WorkyRuntimeStartRequest } from './worky-runtime.client';
import { ModelsService } from '../../models/models.service';
import {
  WorkyStreamDocument,
} from '../schemas/worky-stream.schema';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';

/**
 * Owns the backend→runtime execution wiring (Part 3 §3.2a, canonical
 * §6.1). Extracted from `WorkyExecutionService` so the latter stays
 * focused on validation, snapshots, and control transitions; runtime
 * calls are a separate concern with their own failure modes.
 *
 * All public methods are fire-and-forget at the call site (the
 * execution service never blocks the HTTP response on runtime
 * availability). They swallow non-throwable runtime errors and surface
 * them as user-visible `stream.terminal` / `stream.updated` SSE frames.
 */
@Injectable()
export class WorkyRuntimeDispatchService {
  constructor(
    private readonly runtime: WorkyRuntimeClient,
    private readonly events: WorkyEventService,
    private readonly models: ModelsService,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyRuntimeDispatchService.name);
  }

  /**
   * Dispatch a stream's ready tasks. Resolves the worker model id via
   * the same priority chain as planning turns: stream persistent →
   * admin default. Forwards runtime SSE frames to the canonical
   * event channel; on failure, emits a `stream.terminal` error frame.
   */
  async dispatchStart(
    stream: WorkyStreamDocument,
    readyTaskIds: string[],
  ): Promise<WorkyRuntimeSseResult> {
    const streamId = (stream._id as Types.ObjectId).toString();
    const ownerId = stream.ownerUserId.toString();
    const request: WorkyRuntimeStartRequest = {
      ready_task_ids: readyTaskIds,
      task_contexts: await this.buildTaskContexts(stream, readyTaskIds),
      context_snapshot: this.buildContextSnapshot(stream),
      worker_model_id: await this.resolveWorkerModelId(stream),
    };
    const result = await this.runtime.start(streamId, request);
    this.forwardFrames(ownerId, streamId, result, 'execution-runtime-start');
    if (!result.ok) {
      this.events.emit(ownerId, streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: {
          error: true,
          source: 'execution-runtime-start',
          errorText: result.error ?? `Runtime returned ${result.status ?? 'unknown status'}`,
        },
      });
    }
    return result;
  }

  /**
   * Resume a paused stream. Runtime treats resume as a no-op re-dispatch
   * of any still-ready tasks.
   */
  async dispatchResume(
    stream: WorkyStreamDocument,
    reason: string | undefined,
  ): Promise<WorkyRuntimeSseResult> {
    const streamId = (stream._id as Types.ObjectId).toString();
    const ownerId = stream.ownerUserId.toString();
    const result = await this.runtime.resume(streamId, {
      trigger: reason ?? 'owner_resume',
      context_snapshot: this.buildContextSnapshot(stream),
    });
    this.forwardFrames(ownerId, streamId, result, 'execution-runtime-resume');
    if (!result.ok) {
      this.events.emit(ownerId, streamId, {
        type: 'stream.terminal',
        emittedAt: Date.now(),
        payload: {
          error: true,
          source: 'execution-runtime-resume',
          errorText: result.error ?? `Runtime returned ${result.status ?? 'unknown status'}`,
        },
      });
    }
    return result;
  }

  /**
   * Graceful stop. Backend state is already terminal; runtime stop
   * retires any active workers. Failure is a warning only.
   */
  async dispatchStop(stream: WorkyStreamDocument): Promise<WorkyRuntimeSseResult> {
    const streamId = (stream._id as Types.ObjectId).toString();
    const ownerId = stream.ownerUserId.toString();
    const result = await this.runtime.stop(streamId);
    this.forwardFrames(ownerId, streamId, result, 'execution-runtime-stop');
    if (!result.ok) {
      this.logger.warn('Worky runtime stop failed; backend state is already terminal', {
        streamId,
        error: result.error,
      });
    }
    return result;
  }

  /**
   * Cancel a single task's worker. Used after a `not_started → canceled`
   * transition. A no-op on the runtime side for tasks that never spawned
   * a worker (the task was canceled before dispatch).
   */
  async dispatchCancelTask(taskId: string): Promise<WorkyRuntimeSseResult> {
    const result = await this.runtime.cancelTask(taskId);
    if (!result.ok) {
      this.logger.warn('Worky runtime cancel failed; backend cancel still applied', {
        taskId,
        error: result.error,
      });
    }
    return result;
  }

  /**
   * Dispatch a single ready task to the runtime (used by the readiness
   * loop when a previously-blocked task becomes runnable). Resolves
   * worker model id the same way as bulk start.
   */
  async dispatchSingleTask(
    stream: WorkyStreamDocument,
    taskId: string,
  ): Promise<WorkyRuntimeSseResult> {
    const streamId = (stream._id as Types.ObjectId).toString();
    const ownerId = stream.ownerUserId.toString();
    const result = await this.runtime.start(streamId, {
      ready_task_ids: [taskId],
      task_contexts: await this.buildTaskContexts(stream, [taskId]),
      context_snapshot: this.buildContextSnapshot(stream),
      worker_model_id: await this.resolveWorkerModelId(stream),
    });
    this.forwardFrames(ownerId, streamId, result, 'execution-runtime-single-task');
    return result;
  }

  // =================================================================
  // Internals
  // =================================================================

  /**
   * Forward runtime execution frames to the canonical SSE channel.
   * Unknown frame types are surfaced as `stream.updated` so the UI can
   * show them in the inspector without losing the live signal.
   */
  private forwardFrames(
    ownerId: string,
    streamId: string,
    result: WorkyRuntimeSseResult,
    source: string,
  ): void {
    for (const frame of result.frames) {
      this.forwardFrame(ownerId, streamId, frame, source);
    }
  }

  private forwardFrame(
    ownerId: string,
    streamId: string,
    frame: WorkyRuntimeFrame,
    source: string,
  ): void {
    const payload: Record<string, unknown> = {
      ...frame.payload,
      runtimeFrameType: frame.type,
      source,
    };
    switch (frame.type) {
      case 'worker.spawned':
        this.events.emit(ownerId, streamId, {
          type: 'worker.spawned',
          emittedAt: Date.now(),
          payload,
        });
        return;
      case 'task.completed':
        this.events.emit(ownerId, streamId, {
          type: 'task.completed',
          emittedAt: Date.now(),
          payload,
        });
        return;
      case 'execution.done':
        this.events.emit(ownerId, streamId, {
          type: 'stream.terminal',
          emittedAt: Date.now(),
          payload: { error: false, source: `${source}-done` },
        });
        return;
      case 'execution.error':
      case 'execution.stopped':
        this.events.emit(ownerId, streamId, {
          type: 'stream.terminal',
          emittedAt: Date.now(),
          payload: {
            error: frame.type === 'execution.error',
            source: `${source}-${frame.type}`,
            errorText: (frame.payload.error as string) ?? '',
          },
        });
        return;
      case 'execution.bootstrap':
      case 'execution.telemetry':
      case 'replan.requested':
        this.events.emit(ownerId, streamId, {
          type: 'stream.updated',
          emittedAt: Date.now(),
          payload,
        });
        return;
      default:
        this.events.emit(ownerId, streamId, {
          type: 'stream.updated',
          emittedAt: Date.now(),
          payload: { ...payload, note: 'unknown-runtime-frame' },
        });
    }
  }

  /**
   * Minimal context snapshot for runtime execution. Mirrors the
   * planning snapshot shape minus the LLM-only fields.
   */
  private buildContextSnapshot(stream: WorkyStreamDocument): Record<string, unknown> {
    return {
      streamId: (stream._id as Types.ObjectId).toString(),
      planVersion: stream.currentPlanVersion ?? stream.executionPlanVersion ?? 0,
      budget: stream.budget
        ? {
            limitUsd: stream.budget.limitUsd ?? 0,
            spendUsd: stream.budget.spendUsd ?? 0,
          }
        : { limitUsd: 0, spendUsd: 0 },
    };
  }

  private async buildTaskContexts(
    stream: WorkyStreamDocument,
    taskIds: string[],
  ): Promise<Record<string, Record<string, unknown>>> {
    const validIds = taskIds.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return {};
    const rows = await this.tasks
      .find({ _id: { $in: validIds.map((id) => new Types.ObjectId(id)) }, streamId: stream._id })
      .select({ title: 1, description: 1, priority: 1, actionCategory: 1, acceptanceCriteria: 1, dependsOn: 1, requiredTools: 1, assigneeType: 1 })
      .lean()
      .exec();
    const contexts: Record<string, Record<string, unknown>> = {};
    for (const task of rows) {
      const id = (task._id as Types.ObjectId).toString();
      contexts[id] = {
        id,
        streamId: (stream._id as Types.ObjectId).toString(),
        planVersion: stream.currentPlanVersion ?? stream.executionPlanVersion ?? 0,
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'medium',
        actionCategory: task.actionCategory ?? 'internal_analysis',
        acceptanceCriteria: task.acceptanceCriteria ?? [],
        dependsOn: (task.dependsOn ?? []).map((dep) => (dep as Types.ObjectId).toString()),
        requiredTools: task.requiredTools ?? [],
        assigneeType: task.assigneeType ?? 'ephemeral_ai_agent',
      };
    }
    return contexts;
  }

  private async resolveWorkerModelId(stream: WorkyStreamDocument): Promise<string | null> {
    if (stream.workerModelId) return stream.workerModelId;
    const defaultModel = await this.models.getDefaultModel();
    return this.models.getModelIdentifier(defaultModel) ?? null;
  }
}
