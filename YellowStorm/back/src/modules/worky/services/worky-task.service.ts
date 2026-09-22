import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyPlanStepComponent, WorkyPlanStepComponentDocument } from '../schemas/worky-plan-step-component.schema';
import { WorkyPlanStepArtifact, WorkyPlanStepArtifactDocument } from '../schemas/worky-plan-step-artifact.schema';
import { LoggerService } from '../../logger';
import { DocumentService } from '../../document/document.service';

const PROJECTION_LIMIT = 2000;

/**
 * Per-task read & state-mutation service. The plan-delta service is the
 * only writer in Part 2; the board projection reads via `projectForBoard`.
 * Future Parts (3/4) extend with execution / cancel / move endpoints.
 */
@Injectable()
export class WorkyTaskService {
  constructor(
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    private readonly logger: LoggerService,
    @InjectModel(WorkyPlanStepComponent.name)
    private readonly stepComponents: Model<WorkyPlanStepComponentDocument>,
    @InjectModel(WorkyPlanStepArtifact.name)
    private readonly stepArtifacts: Model<WorkyPlanStepArtifactDocument>,
    private readonly documents: DocumentService,
  ) {
    this.logger.setContext(WorkyTaskService.name);
  }

  /**
   * Sign a task artifact's stored file for viewing/downloading — mirrors the
   * conversation's ConversationArtifactService.resolveDownloadUrl so the task
   * drawer can open generated files in the same file viewer. Scoped to the task
   * (stream + step) so a caller can't sign another stream's artifact; the route
   * guard already checks stream ownership. `artifactId` is the artifact's
   * externalId (the id surfaced by getResultContent).
   */
  async resolveArtifactUrl(taskId: string, artifactId: string): Promise<{ viewUrl: string; downloadUrl: string }> {
    if (!Types.ObjectId.isValid(taskId)) throw new NotFoundException('Task not found');
    const task = await this.tasks.findById(new Types.ObjectId(taskId)).lean().exec();
    if (!task || typeof task.externalId !== 'string') throw new NotFoundException('Task not found');
    const art = await this.stepArtifacts
      .findOne({ streamId: task.streamId as Types.ObjectId, stepExternalId: task.externalId, externalId: artifactId })
      .lean()
      .exec();
    const filePath = art?.filePath as string | undefined;
    if (!art || !filePath) throw new NotFoundException('Artifact not found');
    const filename = ((art.filename as string) || 'artifact').replace(/["\r\n]/g, '');
    const [viewUrl, downloadUrl] = await Promise.all([
      this.documents.generateSasUrl(filePath, { expiryMinutes: 10, checkExists: true }),
      this.documents.generateSasUrl(filePath, {
        expiryMinutes: 10,
        contentDisposition: `attachment; filename="${filename}"`,
        checkExists: true,
      }),
    ]);
    return { viewUrl, downloadUrl };
  }

  /**
   * Lazy step result-content: the components + file artifacts a step produced,
   * keyed by the step's `externalId` (== plan_steps.step_id). Fetched only when
   * the task drawer opens, so the frequently-refetched board response stays lean.
   */
  async getResultContent(taskId: string): Promise<{
    components: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    artifacts: Array<{ id: string; filePath: string; filename: string; artifactKind: string | null; mimeType: string | null; size: number | null; createdAt: string }>;
  }> {
    if (!Types.ObjectId.isValid(taskId)) return { components: [], artifacts: [] };
    const task = await this.tasks.findById(new Types.ObjectId(taskId)).lean().exec();
    if (!task || typeof task.externalId !== 'string') return { components: [], artifacts: [] };
    const filter = { streamId: task.streamId as Types.ObjectId, stepExternalId: task.externalId };

    const [componentDocs, artifactDocs] = await Promise.all([
      this.stepComponents.find(filter).sort({ ordinal: 1 }).lean().exec(),
      this.stepArtifacts.find(filter).sort({ createdAt: 1 }).lean().exec(),
    ]);

    return {
      components: componentDocs.map((c) => ({ id: (c.externalId as string) ?? '', type: c.type as string, data: (c.data as Record<string, unknown>) ?? {} })),
      artifacts: artifactDocs.map((a) => ({
        id: (a.externalId as string) ?? '',
        filePath: a.filePath as string,
        filename: a.filename as string,
        artifactKind: (a.artifactKind as string | null) ?? null,
        mimeType: (a.mimeType as string | null) ?? null,
        size: (a.size as number | null) ?? null,
        createdAt: (a.createdAt as Date).toISOString(),
      })),
    };
  }

  /**
   * Project the stream's tasks onto the user-visible Kanban lanes
   * (`backlog|ready|running|review|blocked|done` plus the terminal
   * `failed|canceled` lanes). The terminal lanes keep a stopped/failed run's
   * tasks on the board with their status rather than dropping them. The status
   * is authored by the orchestrator via Electric — we only surface it, never
   * set it here. `superseded|archived` remain excluded as pure system states.
   *
   * Tasks whose id appears in `blockedTaskIds` (typically because a
   * pending `WorkyInteraction.blocksTaskIds` contains them) are placed
   * in the `blocked` lane and annotated with the blocker reason. The
   * underlying `lane` field on the document is left untouched — the
   * projection is the source of truth for the UI.
   */
  async projectForBoard(
    streamId: string,
    blockersByTaskId: Map<string, string[]>,
  ): Promise<Record<string, IBoardTaskView[]>> {
    const objectId = new Types.ObjectId(streamId);
    const tasks = await this.tasks
      .find({ streamId: objectId, lane: { $in: BOARD_LANES } })
      .sort({ updatedAt: 1 })
      .limit(PROJECTION_LIMIT)
      .lean()
      .exec();

    const lanes: Record<string, IBoardTaskView[]> = {
      backlog: [],
      ready: [],
      running: [],
      review: [],
      blocked: [],
      done: [],
      failed: [],
      canceled: [],
    };
    for (const task of tasks) {
      const id = (task._id as Types.ObjectId).toString();
      const blockerReasons = blockersByTaskId.get(id) ?? [];
      const projectionLane: BoardLane = blockerReasons.length > 0 ? 'blocked' : ((task.lane ?? 'backlog') as BoardLane);
      if (!lanes[projectionLane]) continue;
      lanes[projectionLane].push({
        id,
        streamId,
        externalId: (task.externalId as string | null | undefined) ?? null,
        ordinal: typeof task.ordinal === 'number' ? task.ordinal : null,
        title: task.title ?? '',
        description: task.description ?? '',
        lane: projectionLane,
        planningStatus: task.planningStatus ?? 'pending',
        executionState: task.executionState ?? 'not_started',
        priority: task.priority ?? 'medium',
        assigneeType: task.assigneeType ?? 'unassigned',
        assigneeId: task.assigneeId ? (task.assigneeId as Types.ObjectId).toString() : null,
        assigneeKey: (task.assigneeKey as string | null | undefined) ?? null,
        kind: (task.kind as string | undefined) ?? 'execute',
        question: (task.question as string | null | undefined) ?? null,
        interruptId: (task.interruptId as string | null | undefined) ?? null,
        assigneeName: (task.assigneeName as string | null | undefined) ?? null,
        assigneeRole: (task.assigneeRole as string | null | undefined) ?? null,
        isPersona: (task.isPersona as boolean | undefined) ?? false,
        isDynamicDelegate: (task.isDynamicDelegate as boolean | undefined) ?? false,
        actionCategory: task.actionCategory ?? 'internal_analysis',
        dependsOn: (task.dependsOn ?? []).map((d) => (d as Types.ObjectId).toString()),
        wave: typeof task.wave === 'number' ? task.wave : null,
        dependsOnStepIds: (task.dependsOnStepIds as string[] | undefined) ?? [],
        blockerReason: blockerReasons.join(', ') || null,
        result: (task.result as string | null | undefined) ?? null,
        blockedReason: (task.blockedReason as string | null | undefined) ?? null,
        theoreticalDeadlineAt: task.theoreticalDeadlineAt
          ? new Date(task.theoreticalDeadlineAt).toISOString()
          : null,
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
        completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
        durationMs: typeof task.durationMs === 'number' ? task.durationMs : null,
        // Mongo timestamps (always populated). createdAt = when the task first
        // appeared on the board; updatedAt = last Electric change / activity.
        // These are the reliable relative-time source for manager-driven tasks,
        // whose startedAt/completedAt the Electric sync never sets.
        createdAt: task.createdAt ? new Date(task.createdAt as Date).toISOString() : null,
        updatedAt: task.updatedAt ? new Date(task.updatedAt as Date).toISOString() : null,
      });
    }
    return lanes;
  }

  /**
   * DEBUG: count tasks for a stream, matching streamId as BOTH an ObjectId
   * and a raw string (via the native driver, bypassing Mongoose casting).
   * Reveals whether the Electric consumer stored streamId with a type that
   * the ObjectId-typed board query can't match.
   */
  async countByStream(streamId: string): Promise<string> {
    const coll = this.tasks.collection;
    let asObjectId = -1;
    let asString = -1;
    try {
      asObjectId = await coll.countDocuments({ streamId: new Types.ObjectId(streamId) });
    } catch {
      /* noop */
    }
    try {
      asString = await coll.countDocuments({ streamId } as Record<string, unknown>);
    } catch {
      /* noop */
    }
    return `objectId=${asObjectId} string=${asString}`;
  }

  /** Resolve the current taskIds by clientTaskId mapping for one stream. */
  async findByIdInternal(taskId: string): Promise<WorkyTaskDocument | null> {
    return this.tasks.findById(taskId).exec();
  }

  async findByIdsInternal(taskIds: string[]): Promise<WorkyTaskDocument[]> {
    if (taskIds.length === 0) return [];
    return this.tasks.find({ _id: { $in: taskIds.map((id) => new Types.ObjectId(id)) } }).exec();
  }
}

export const BOARD_LANES = [
  'backlog',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
  // Terminal lanes. The orchestrator sets these via Electric (a run that is
  // stopped cancels its tasks; a step that errors fails) and we surface them so
  // the tasks stay visible with their status instead of vanishing off the board.
  'failed',
  'canceled',
] as const;

export type BoardLane = (typeof BOARD_LANES)[number];

export interface IBoardTaskView {
  id: string;
  streamId: string;
  /** plan_steps.step_id (Electric source) — what `dependsOnStepIds` entries refer to. */
  externalId: string | null;
  ordinal: number | null;
  title: string;
  description: string;
  lane: BoardLane;
  planningStatus: string;
  executionState: string;
  priority: string;
  assigneeType: string;
  assigneeId: string | null;
  /** plan_steps.assignee (Electric source) — executor sub-agent that handled this task; null when unattributed. */
  assigneeKey: string | null;
  kind: string;
  question: string | null;
  interruptId: string | null;
  assigneeName: string | null;
  assigneeRole: string | null;
  isPersona: boolean;
  isDynamicDelegate: boolean;
  actionCategory: string;
  dependsOn: string[];
  /** Parallel wave index (plan_steps.wave via Electric); null outside a plan. */
  wave: number | null;
  /** step_ids this step depends on (plan_steps.depends_on via Electric). */
  dependsOnStepIds: string[];
  blockerReason: string | null;
  result: string | null;
  blockedReason: string | null;
  theoreticalDeadlineAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** Mongo doc creation time — when the task first appeared on the board. */
  createdAt: string | null;
  /** Mongo doc last-modified time — last Electric change / activity. */
  updatedAt: string | null;
}
