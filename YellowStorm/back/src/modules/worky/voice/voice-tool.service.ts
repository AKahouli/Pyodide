import { Injectable, Logger } from '@nestjs/common';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyOrchestratorGrpcClientService } from '../services/worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from '../services/worky-turn-context.service';
import { WorkyTaskService } from '../services/worky-task.service';
import { UserService } from '../../user/user.service';
import { requesterOpts } from '../worky-requester.util';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

/** Cap the result text so the model summarizes it rather than reading a wall of text aloud. */
const RESULT_MAX_CHARS = 1200;
/** Cap the artifact list so a task that produced many files stays voice-digestible. */
const MAX_ARTIFACTS = 10;

/** Compact per-task summary the concierge uses to orient (via list_tasks). */
export interface VoiceTaskSummary {
  id: string;
  title: string;
  lane: string;
  executionState: string;
  blocked: boolean;
}

/** Voice-friendly per-task detail the concierge uses to describe a task (via get_task_details). */
export interface VoiceTaskDetails {
  id: string;
  title: string;
  description: string;
  lane: string;
  executionState: string;
  result: string | null;
  resultTruncated: boolean;
  blockedReason: string | null;
  acceptanceCriteria: string[];
  /** The executor sub-agent that handled the task (null when unattributed). */
  assigneeKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  budget: { estimateUsd: number; actualUsd: number } | null;
  artifacts: Array<{ filename: string; kind: string | null }>;
}

@Injectable()
export class VoiceToolService {
  private readonly logger = new Logger(VoiceToolService.name);

  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly tasks: WorkyTaskService,
    private readonly users: UserService,
  ) {}

  async dispatchTask(
    userId: string,
    streamId: string,
    message: string,
  ): Promise<{ runId: string; sessionId: string; accepted: boolean }> {
    await this.planning.appendOwnerMessage(userId, streamId, { content: message });
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const [agents, connectors, user] = await Promise.all([
      this.turnContext.resolveWorkyAgents(userId),
      this.turnContext.resolveConnectors(userId),
      this.users.findById(userId),
    ]);
    const res = await this.orchestrator.runTask(userId, ctx.aiSessionId, message, {
      agents,
      connectors,
      ...(user ? requesterOpts(user) : {}),
    });
    this.logger.log(`[voice] dispatched task run=${res.runId} session=${res.sessionId}`);
    return { runId: res.runId, sessionId: res.sessionId, accepted: res.accepted };
  }

  /**
   * Stop the whole run for this stream via the terminal StopSession RPC —
   * cancels the in-flight turn and every task under it; the session cannot be
   * resumed afterwards. Ownership-checked. When no orchestrator session was ever
   * started (no `aiSessionId`) there is nothing to stop, so we return
   * `stopped: false` rather than error — same non-terminal shape the REST
   * `:id/stop` endpoint uses.
   */
  async stopSession(userId: string, streamId: string): Promise<{ stopped: boolean }> {
    await this.streamService.findById(userId, streamId);
    const stream = await this.streamService.findByIdInternal(streamId);
    const aiSessionId = stream?.aiSessionId;
    if (!aiSessionId) return { stopped: false };
    const res = await this.orchestrator.stopSession(userId, aiSessionId);
    this.logger.log(`[voice] stopped session=${aiSessionId} stream=${streamId} stopped=${res.stopped}`);
    return res;
  }

  async queryStatus(userId: string, streamId: string): Promise<{ status: string; title: string; plan: unknown }> {
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const s = await this.orchestrator.getSession(userId, ctx.aiSessionId);
    return { status: s.status, title: s.title, plan: s.plan };
  }

  /**
   * List the stream's tasks as compact summaries so the concierge can orient
   * and pick one to describe. Ownership-checked; reuses the board projection
   * (six user-visible lanes) so voice sees exactly what the Kanban shows.
   */
  async listTasks(userId: string, streamId: string): Promise<{ tasks: VoiceTaskSummary[] }> {
    await this.streamService.findById(userId, streamId);
    const lanes = await this.tasks.projectForBoard(streamId, new Map());
    const tasks: VoiceTaskSummary[] = Object.values(lanes)
      .flat()
      .map((t) => ({
        id: t.id,
        title: t.title,
        lane: t.lane,
        executionState: t.executionState,
        blocked: t.lane === 'blocked' || t.blockerReason != null,
      }));
    return { tasks };
  }

  /**
   * Full voice-friendly detail for one task (metadata, result, produced
   * artifacts) so the concierge can describe it richly. Ownership-checked, and
   * the task must belong to the given stream. The result text is trimmed and
   * artifact lookup is best-effort so a slow/failed content query never blocks
   * the description.
   */
  async getTaskDetails(userId: string, streamId: string, taskId: string): Promise<VoiceTaskDetails> {
    await this.streamService.findById(userId, streamId);
    const task = await this.tasks.findByIdInternal(taskId);
    if (!task || task.streamId.toString() !== streamId) {
      throw new NotFoundException(ErrorCode.WORKY_TASK_NOT_FOUND, 'Worky task not found.');
    }

    const result = task.result ?? null;
    const resultTruncated = !!result && result.length > RESULT_MAX_CHARS;
    const trimmed = resultTruncated ? result!.slice(0, RESULT_MAX_CHARS) : result;

    let artifacts: Array<{ filename: string; kind: string | null }> = [];
    try {
      const content = await this.tasks.getResultContent(taskId);
      artifacts = content.artifacts
        .slice(0, MAX_ARTIFACTS)
        .map((a) => ({ filename: a.filename, kind: a.artifactKind }));
    } catch (err) {
      this.logger.warn(`[voice] getResultContent failed task=${taskId}: ${err instanceof Error ? err.message : err}`);
    }

    return {
      id: taskId,
      title: task.title ?? '',
      description: task.description ?? '',
      lane: task.lane ?? 'backlog',
      executionState: task.executionState ?? 'not_started',
      result: trimmed,
      resultTruncated,
      blockedReason: task.blockedReason ?? null,
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      assigneeKey: task.assigneeKey ?? null,
      startedAt: task.startedAt ? task.startedAt.toISOString() : null,
      completedAt: task.completedAt ? task.completedAt.toISOString() : null,
      durationMs: typeof task.durationMs === 'number' ? task.durationMs : null,
      budget: task.budget
        ? { estimateUsd: task.budget.estimateUsd, actualUsd: task.budget.actualUsd }
        : null,
      artifacts,
    };
  }
}
