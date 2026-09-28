import { Injectable, NotFoundException } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { WorkyMirrorRepository } from '../persistence/worky-mirror.repository';
import type { WorkyTaskRecord } from '../worky.types';
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
    private readonly tasks: WorkyTaskRepository,
    private readonly mirror: WorkyMirrorRepository,
    private readonly documents: DocumentService,
    private readonly logger: LoggerService,
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
    if (!isObjectId(taskId)) throw new NotFoundException('Task not found');
    const task = await this.tasks.findById(taskId);
    if (!task || task.externalId === null) throw new NotFoundException('Task not found');
    const art = await this.mirror.findStepArtifact(task.streamId, task.externalId, artifactId);
    if (!art || !art.filePath) throw new NotFoundException('Artifact not found');
    const filename = (art.filename || 'artifact').replace(/["\r\n]/g, '');
    const [viewUrl, downloadUrl] = await Promise.all([
      this.documents.generateSasUrl(art.filePath, { expiryMinutes: 10, checkExists: true }),
      this.documents.generateSasUrl(art.filePath, {
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
    if (!isObjectId(taskId)) return { components: [], artifacts: [] };
    const task = await this.tasks.findById(taskId);
    if (!task || task.externalId === null) return { components: [], artifacts: [] };

    const [components, artifacts] = await Promise.all([
      this.mirror.listStepComponents(task.streamId, task.externalId),
      this.mirror.listStepArtifacts(task.streamId, task.externalId),
    ]);

    return {
      components: components.map((c) => ({ id: c.externalId ?? '', type: c.type, data: c.data })),
      artifacts: artifacts.map((a) => ({
        id: a.externalId ?? '',
        filePath: a.filePath,
        filename: a.filename,
        artifactKind: a.artifactKind,
        mimeType: a.mimeType,
        size: a.size,
        createdAt: a.createdAt.toISOString(),
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
   * underlying `lane` column is left untouched — the projection is the
   * source of truth for the UI.
   */
  async projectForBoard(
    streamId: string,
    blockersByTaskId: Map<string, string[]>,
  ): Promise<Record<string, IBoardTaskView[]>> {
    const tasks = await this.tasks.listForBoard(streamId, BOARD_LANES, PROJECTION_LIMIT);

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
      const blockerReasons = blockersByTaskId.get(task.id) ?? [];
      const projectionLane = (blockerReasons.length > 0 ? 'blocked' : task.lane) as BoardLane;
      if (!lanes[projectionLane]) continue;
      lanes[projectionLane].push({
        id: task.id,
        streamId,
        externalId: task.externalId,
        ordinal: task.ordinal,
        title: task.title,
        description: task.description,
        lane: projectionLane,
        planningStatus: task.planningStatus,
        executionState: task.executionState,
        priority: task.priority,
        assigneeType: task.assigneeType,
        assigneeId: task.assigneeId,
        assigneeKey: task.assigneeKey,
        kind: task.kind,
        question: task.question,
        interruptId: task.interruptId,
        assigneeName: task.assigneeName,
        assigneeRole: task.assigneeRole,
        isPersona: task.isPersona,
        isDynamicDelegate: task.isDynamicDelegate,
        actionCategory: task.actionCategory,
        dependsOn: task.dependsOn,
        wave: task.wave,
        dependsOnStepIds: task.dependsOnStepIds,
        blockerReason: blockerReasons.join(', ') || null,
        result: task.result,
        blockedReason: task.blockedReason,
        theoreticalDeadlineAt: task.theoreticalDeadlineAt?.toISOString() ?? null,
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        durationMs: task.durationMs,
        // Row timestamps (always populated). createdAt = when the task first
        // appeared on the board; updatedAt = last Electric change / activity.
        // These are the reliable relative-time source for manager-driven tasks,
        // whose startedAt/completedAt the Electric sync never sets.
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      });
    }
    return lanes;
  }

  /** Every task of the stream, whatever its lane: the board logs it next to the projected count. */
  async countByStream(streamId: string): Promise<number> {
    return this.tasks.countByStream(streamId);
  }

  /** Internal lookups: no access check. */
  async findByIdInternal(taskId: string): Promise<WorkyTaskRecord | null> {
    return this.tasks.findById(taskId);
  }

  async findByIdsInternal(taskIds: string[]): Promise<WorkyTaskRecord[]> {
    return this.tasks.findByIds(taskIds);
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
  /** Row creation time — when the task first appeared on the board. */
  createdAt: string | null;
  /** Row last-modified time — last Electric change / activity. */
  updatedAt: string | null;
}
