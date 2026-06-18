import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyStream,
  WorkyStreamDocument,
} from '../schemas/worky-stream.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import {
  WorkyExecutionReport,
  WorkyExecutionReportDocument,
} from '../schemas/worky-execution-report.schema';
import {
  WorkyCostEvent,
  WorkyCostEventDocument,
} from '../schemas/worky-cost-event.schema';
import {
  WorkyAuditEvent,
  WorkyAuditEventDocument,
} from '../schemas/worky-audit-event.schema';
import {
  WorkyEphemeralWorker,
  WorkyEphemeralWorkerDocument,
} from '../schemas/worky-ephemeral-worker.schema';
import {
  WorkyInteraction,
  WorkyInteractionDocument,
} from '../schemas/worky-interaction.schema';
import { LoggerService } from '../../logger';
import { WorkyEventService } from './worky-event.service';
import { WorkyMemoryService } from './worky-memory.service';

const TERMINAL_STATUSES = new Set(['completed', 'stopped', 'archived']);
const TASK_LANES = [
  'backlog',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
  'failed',
  'canceled',
  'superseded',
];

export interface IWorkyExecutionReportResponse {
  id: string;
  streamId: string;
  type: 'rich' | 'lightweight' | 'summary';
  status: 'generating' | 'ready' | 'failed';
  summary: string;
  markdown: string;
  metadata: Record<string, unknown>;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Always-generated execution report (Part 4 §6, canonical §9, §20).
 *
 *   - `generate(streamId)` runs at any terminal state
 *     (`completed | stopped | archived`). Rich if the stream's
 *     `budget.spendUsd < budget.limitUsd` AND no `budget.exhausted`
 *     event was observed; lightweight otherwise.
 *   - The Markdown is built deterministically from the events,
 *     tasks, artifacts (cost events), ephemeral workers, and
 *     governance evaluations persisted in Mongo. The runtime is the
 *     source of the raw LLM/tool traces; the backend holds the
 *     durable summary.
 *   - The report is persisted to `WorkyExecutionReport` with
 *     `type`, `status`, `summary`, `markdown`, `metadata`. The
 *     frontend renders both the structured `summary` and the
 *     full Markdown.
 *   - Emits `report.generated` SSE so the frontend can navigate
 *     to the report page in real-time.
 */
@Injectable()
export class WorkyReportService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    @InjectModel(WorkyExecutionReport.name)
    private readonly reports: Model<WorkyExecutionReportDocument>,
    @InjectModel(WorkyCostEvent.name)
    private readonly costEvents: Model<WorkyCostEventDocument>,
    @InjectModel(WorkyAuditEvent.name)
    private readonly audits: Model<WorkyAuditEventDocument>,
    @InjectModel(WorkyEphemeralWorker.name)
    private readonly workers: Model<WorkyEphemeralWorkerDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteractionDocument>,
    private readonly events: WorkyEventService,
    private readonly memory: WorkyMemoryService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyReportService.name);
  }

  /**
   * Generate (or regenerate) a report for a stream. Idempotent: if a
   * `ready` report already exists, it is overwritten with a fresh one.
   * The MVP does not write the Markdown to the workspace's
   * `/final-deliverables/...` folder; that is a Part 5+ hardening
   * follow-up. The Markdown is stored in the `WorkyExecutionReport`
   * row itself.
   */
  async generate(streamId: string): Promise<IWorkyExecutionReportResponse> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new Error(`WorkyReportService.generate: invalid streamId`);
    }
    const stream = await this.streams.findById(streamId).exec();
    if (!stream) {
      throw new Error(`WorkyReportService.generate: stream ${streamId} not found`);
    }
    if (!TERMINAL_STATUSES.has(stream.status)) {
      this.logger.warn('WorkyReportService.generate: stream not terminal', {
        streamId,
        status: stream.status,
      });
    }
    const budgetExhausted =
      (stream.budget.limitUsd > 0 && stream.budget.spendUsd >= stream.budget.limitUsd) ||
      (stream.budget.limitTokens > 0 && stream.budget.tokensUsed >= stream.budget.limitTokens);
    const type: 'rich' | 'lightweight' = budgetExhausted ? 'lightweight' : 'rich';

    const [
      tasks,
      costAgg,
      auditEvents,
      workers,
      interactions,
    ] = await Promise.all([
      this.tasks
        .find({ streamId: stream._id })
        .select({ title: 1, lane: 1, executionState: 1, assigneeType: 1, assigneeId: 1, actionCategory: 1, budget: 1, theoreticalDeadlineAt: 1 })
        .lean()
        .exec(),
      this.costEvents
        .aggregate([
          { $match: { streamId: stream._id } },
          {
            $group: {
              _id: null,
              totalCostUsd: { $sum: '$costUsd' },
              totalInputTokens: { $sum: '$inputTokens' },
              totalOutputTokens: { $sum: '$outputTokens' },
              eventCount: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.audits
        .find({ streamId: stream._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.workers
        .find({ streamId: stream._id })
        .select({ role: 1, status: 1, createdAt: 1, retiredAt: 1 })
        .lean()
        .exec(),
      this.interactions
        .find({ streamId: stream._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);
    const totals = costAgg[0] ?? {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      eventCount: 0,
    };

    const summary = this.buildSummary(stream, tasks, totals, type);
    const markdown =
      type === 'rich'
        ? this.buildRichMarkdown(stream, tasks, totals, auditEvents, workers, interactions)
        : this.buildLightweightMarkdown(stream, tasks, totals, auditEvents);
    const metadata: Record<string, unknown> = {
      taskCount: tasks.length,
      workerCount: workers.length,
      interactionCount: interactions.length,
      auditCount: auditEvents.length,
      costEventCount: totals.eventCount,
      budgetExhausted,
      generatedFromStatus: stream.status,
    };
    const existing = await this.reports.findOne({ streamId: stream._id }).exec();
    let saved: WorkyExecutionReportDocument;
    if (existing) {
      existing.type = type;
      existing.status = 'ready';
      existing.summary = summary;
      existing.markdown = markdown;
      existing.metadata = metadata;
      existing.generatedAt = new Date();
      saved = await existing.save();
    } else {
      saved = await this.reports.create({
        streamId: stream._id,
        type,
        status: 'ready',
        summary,
        markdown,
        metadata,
        generatedAt: new Date(),
      });
    }
    this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
      type: 'report.generated',
      emittedAt: Date.now(),
      payload: {
        reportId: saved._id.toString(),
        type,
        budgetExhausted,
      },
    });
    // Auto-propose a memory entry for the stream owner. Confirm-before-
    // write semantics (Part 4 §7, canonical §21): nothing is written
    // to `WorkyMemoryEntry` until the owner calls
    // `POST /worky/memory/proposals/{id}/confirm`.
    try {
      await this.memory.propose({
        ownerUserId: stream.ownerUserId.toString(),
        sourceStreamId: stream._id.toString(),
        category: 'stream_summary',
        title: `Stream summary: ${stream.title}`,
        content: summary,
      });
    } catch (err) {
      this.logger.warn('Worky memory proposal after report failed', {
        streamId,
        error: (err as Error).message,
      });
    }
    this.logger.log('Worky execution report generated', {
      streamId,
      type,
      reportId: saved._id.toString(),
    });
    return this.toResponse(saved);
  }

  async findForStream(streamId: string): Promise<IWorkyExecutionReportResponse | null> {
    if (!Types.ObjectId.isValid(streamId)) return null;
    const report = await this.reports.findOne({ streamId: new Types.ObjectId(streamId) }).exec();
    return report ? this.toResponse(report) : null;
  }

  // =================================================================
  // Markdown builders
  // =================================================================

  private buildSummary(
    stream: WorkyStreamDocument,
    tasks: Array<{ lane?: string; executionState?: string }>,
    totals: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; eventCount: number },
    type: 'rich' | 'lightweight',
  ): string {
    const done = tasks.filter((t) => t.lane === 'done').length;
    const failed = tasks.filter((t) => t.lane === 'failed').length;
    const canceled = tasks.filter((t) => t.lane === 'canceled').length;
    return [
      `Stream "${stream.title}" (${type} report)`,
      `Tasks: ${tasks.length} (done=${done} failed=${failed} canceled=${canceled})`,
      `Cost: $${totals.totalCostUsd.toFixed(4)} (${totals.totalInputTokens + totals.totalOutputTokens} tokens)`,
      `Cost events: ${totals.eventCount}`,
      `Status: ${stream.status}`,
    ].join(' • ');
  }

  private buildRichMarkdown(
    stream: WorkyStreamDocument,
    tasks: Array<Record<string, unknown>>,
    totals: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; eventCount: number },
    auditEvents: Array<{ action?: string; createdAt?: Date }>,
    workers: Array<Record<string, unknown>>,
    interactions: Array<{ type?: string; status?: string; question?: string; response?: string | null; createdAt?: Date }>,
  ): string {
    const lines: string[] = [];
    lines.push(`# Worky Execution Report — ${stream.title}`);
    lines.push('');
    lines.push(`**Type:** rich • **Status:** ${stream.status} • **Generated:** ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(this.buildSummary(stream, tasks as never, totals, 'rich'));
    lines.push('');
    lines.push('## Tasks');
    lines.push('');
    const byLane = new Map<string, number>();
    for (const t of tasks) {
      const lane = String(t.lane ?? 'unknown');
      byLane.set(lane, (byLane.get(lane) ?? 0) + 1);
    }
    for (const lane of TASK_LANES) {
      const n = byLane.get(lane);
      if (n) lines.push(`- ${lane}: ${n}`);
    }
    lines.push('');
    lines.push('## Cost');
    lines.push('');
    lines.push(`- USD total: $${totals.totalCostUsd.toFixed(4)}`);
    lines.push(`- Input tokens: ${totals.totalInputTokens}`);
    lines.push(`- Output tokens: ${totals.totalOutputTokens}`);
    lines.push(`- Cost events: ${totals.eventCount}`);
    lines.push('');
    lines.push('## Ephemeral workers');
    lines.push('');
    lines.push(`Total spawned: ${workers.length}`);
    lines.push('');
    lines.push('## Interactions');
    lines.push('');
    for (const i of interactions) {
      lines.push(`- [${i.status}] (${i.type}) ${i.question}${i.response ? ` → ${i.response}` : ''}`);
    }
    lines.push('');
    lines.push('## Audit trail');
    lines.push('');
    for (const a of auditEvents.slice(0, 200)) {
      lines.push(`- ${a.createdAt?.toISOString() ?? '?'} ${a.action}`);
    }
    if (auditEvents.length > 200) {
      lines.push(`- ... ${auditEvents.length - 200} more audit rows truncated`);
    }
    return lines.join('\n');
  }

  private buildLightweightMarkdown(
    stream: WorkyStreamDocument,
    tasks: Array<Record<string, unknown>>,
    totals: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; eventCount: number },
    auditEvents: Array<{ action?: string; createdAt?: Date }>,
  ): string {
    const lines: string[] = [];
    lines.push(`# Worky Execution Report (lightweight) — ${stream.title}`);
    lines.push('');
    lines.push(`> Budget exhausted; this is a deterministic summary from durable events only.`);
    lines.push('');
    lines.push(`**Status:** ${stream.status} • **Generated:** ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(this.buildSummary(stream, tasks as never, totals, 'lightweight'));
    lines.push('');
    lines.push('## Tasks');
    for (const t of tasks) {
      lines.push(`- ${t.lane}: ${t.title}`);
    }
    lines.push('');
    lines.push('## Audit trail');
    for (const a of auditEvents.slice(0, 100)) {
      lines.push(`- ${a.createdAt?.toISOString() ?? '?'} ${a.action}`);
    }
    if (auditEvents.length > 100) {
      lines.push(`- ... ${auditEvents.length - 100} more audit rows truncated`);
    }
    return lines.join('\n');
  }

  private toResponse(doc: WorkyExecutionReportDocument): IWorkyExecutionReportResponse {
    return {
      id: doc._id.toString(),
      streamId: doc.streamId.toString(),
      type: doc.type as 'rich' | 'lightweight' | 'summary',
      status: doc.status as 'generating' | 'ready' | 'failed',
      summary: doc.summary,
      markdown: doc.markdown,
      metadata: doc.metadata,
      generatedAt: doc.generatedAt ? doc.generatedAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
