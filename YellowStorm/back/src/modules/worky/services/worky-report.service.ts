import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { WorkyReportRepository } from '../persistence/worky-report.repository';
import { WorkyBudgetRepository, type WorkyCostTotals } from '../persistence/worky-budget.repository';
import { WorkyAuditRepository } from '../persistence/worky-audit.repository';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import type {
  WorkyAuditEventRecord,
  WorkyEphemeralWorkerRecord,
  WorkyExecutionReportRecord,
  WorkyInteractionRecord,
  WorkyStreamRecord,
  WorkyTaskRecord,
} from '../worky.types';
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
 *     governance evaluations persisted in Postgres. The runtime is the
 *     source of the raw LLM/tool traces; the backend holds the
 *     durable summary.
 *   - The report is persisted to `worky.execution_reports` (one per
 *     stream) with `type`, `status`, `summary`, `markdown`, `metadata`. The
 *     frontend renders both the structured `summary` and the
 *     full Markdown.
 *   - Emits `report.generated` SSE so the frontend can navigate
 *     to the report page in real-time.
 */
@Injectable()
export class WorkyReportService {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly reports: WorkyReportRepository,
    private readonly budgets: WorkyBudgetRepository,
    private readonly audits: WorkyAuditRepository,
    private readonly interactions: WorkyInteractionRepository,
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
   * follow-up. The Markdown is stored in the execution report row
   * itself.
   */
  async generate(streamId: string): Promise<IWorkyExecutionReportResponse> {
    if (!isObjectId(streamId)) {
      throw new Error(`WorkyReportService.generate: invalid streamId`);
    }
    const stream = await this.streams.findById(streamId);
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
      totals,
      auditEvents,
      workers,
      interactions,
    ] = await Promise.all([
      this.tasks.listByStream(stream.id),
      this.budgets.costTotals(stream.id),
      // Oldest first, by occurredAt.
      this.audits.listForScope(stream.id),
      this.audits.listWorkersByStream(stream.id),
      this.interactions.listByStream(stream.id),
    ]);

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
    // One report per stream: a regeneration overwrites it in place.
    const saved = await this.reports.upsert(stream.id, {
      type,
      status: 'ready',
      summary,
      markdown,
      metadata,
      generatedAt: new Date(),
    });
    this.events.emit(stream.ownerUserId, stream.id, {
      type: 'report.generated',
      emittedAt: Date.now(),
      payload: {
        reportId: saved.id,
        type,
        budgetExhausted,
      },
    });
    // Auto-propose a memory entry for the stream owner. Confirm-before-
    // write semantics (Part 4 §7, canonical §21): nothing is written
    // to the memory entries until the owner calls
    // `POST /worky/memory/proposals/{id}/confirm`.
    try {
      await this.memory.propose({
        ownerUserId: stream.ownerUserId,
        sourceStreamId: stream.id,
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
      reportId: saved.id,
    });
    return this.toResponse(saved);
  }

  async findForStream(streamId: string): Promise<IWorkyExecutionReportResponse | null> {
    if (!isObjectId(streamId)) return null;
    const report = await this.reports.findByStream(streamId);
    return report ? this.toResponse(report) : null;
  }

  // =================================================================
  // Markdown builders
  // =================================================================

  private buildSummary(
    stream: WorkyStreamRecord,
    tasks: WorkyTaskRecord[],
    totals: WorkyCostTotals,
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
    stream: WorkyStreamRecord,
    tasks: WorkyTaskRecord[],
    totals: WorkyCostTotals,
    auditEvents: WorkyAuditEventRecord[],
    workers: WorkyEphemeralWorkerRecord[],
    interactions: WorkyInteractionRecord[],
  ): string {
    const lines: string[] = [];
    lines.push(`# Worky Execution Report — ${stream.title}`);
    lines.push('');
    lines.push(`**Type:** rich • **Status:** ${stream.status} • **Generated:** ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(this.buildSummary(stream, tasks, totals, 'rich'));
    lines.push('');
    lines.push('## Tasks');
    lines.push('');
    const byLane = new Map<string, number>();
    for (const t of tasks) {
      const lane = t.lane;
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
      lines.push(`- ${a.occurredAt.toISOString()} ${a.action}`);
    }
    if (auditEvents.length > 200) {
      lines.push(`- ... ${auditEvents.length - 200} more audit rows truncated`);
    }
    return lines.join('\n');
  }

  private buildLightweightMarkdown(
    stream: WorkyStreamRecord,
    tasks: WorkyTaskRecord[],
    totals: WorkyCostTotals,
    auditEvents: WorkyAuditEventRecord[],
  ): string {
    const lines: string[] = [];
    lines.push(`# Worky Execution Report (lightweight) — ${stream.title}`);
    lines.push('');
    lines.push(`> Budget exhausted; this is a deterministic summary from durable events only.`);
    lines.push('');
    lines.push(`**Status:** ${stream.status} • **Generated:** ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(this.buildSummary(stream, tasks, totals, 'lightweight'));
    lines.push('');
    lines.push('## Tasks');
    for (const t of tasks) {
      lines.push(`- ${t.lane}: ${t.title}`);
    }
    lines.push('');
    lines.push('## Audit trail');
    for (const a of auditEvents.slice(0, 100)) {
      lines.push(`- ${a.occurredAt.toISOString()} ${a.action}`);
    }
    if (auditEvents.length > 100) {
      lines.push(`- ... ${auditEvents.length - 100} more audit rows truncated`);
    }
    return lines.join('\n');
  }

  private toResponse(row: WorkyExecutionReportRecord): IWorkyExecutionReportResponse {
    return {
      id: row.id,
      streamId: row.streamId,
      type: row.type as 'rich' | 'lightweight' | 'summary',
      status: row.status as 'generating' | 'ready' | 'failed',
      summary: row.summary,
      markdown: row.markdown,
      metadata: row.metadata,
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
