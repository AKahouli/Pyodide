import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { StepStatus } from '../schemas/playbook-execution.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
} from '../schemas/playbook-execution.schema';
import { PlaybookService } from './playbook.service';
import { LoggerService } from '../../logger';
import { EmailService } from '../../email/email.service';
import { UserService } from '../../user/user.service';

@Injectable()
export class PlaybookExecutionNotificationService {
  private readonly frontendBaseUrl: string;

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly playbookService: PlaybookService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly emailService: EmailService,
    private readonly userService: UserService,
  ) {
    this.logger.setContext('PlaybookExecutionNotificationService');
    this.frontendBaseUrl = (
      this.configService.get<string>('app.frontendUrl', 'http://localhost:5173') || ''
    ).replace(/\/$/, '');
  }

  buildExecutionDetailUrl(playbookId: string, executionId: string): string {
    return `${this.frontendBaseUrl}/#/playbooks/${playbookId}/executions/${executionId}`;
  }

  formatExecutionSummaryForEmail(doc: {
    executionNumber?: number;
    taskResults?: Array<{ status?: string }>;
    startedAt?: Date;
    completedAt?: Date | null;
  }): string | null {
    const segments: string[] = [];

    const runNum = doc.executionNumber;
    if (runNum != null && Number.isFinite(Number(runNum))) {
      segments.push(`Run #${runNum}`);
    }

    const tasks = doc.taskResults ?? [];
    if (tasks.length > 0) {
      const byStatus = new Map<string, number>();
      for (const t of tasks) {
        const key = String(t.status ?? '').toLowerCase();
        if (!key) continue;
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
      }

      const stepParts = (
        [
          [StepStatus.COMPLETED, 'completed'],
          [StepStatus.FAILED, 'failed'],
          [StepStatus.SKIPPED, 'skipped'],
          [StepStatus.RUNNING, 'running'],
          [StepStatus.PENDING, 'pending'],
        ] as const
      )
        .map(([status, label]) => {
          const n = byStatus.get(status) ?? 0;
          return n ? `${n} ${label}` : null;
        })
        .filter((s): s is string => s != null);

      if (stepParts.length) {
        segments.push(`Steps: ${stepParts.join(', ')}`);
      }
    }

    if (doc.startedAt && doc.completedAt) {
      const ms = new Date(doc.completedAt).getTime() - new Date(doc.startedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        segments.push(`Duration: ${Math.round(ms / 1000)}s`);
      }
    }

    return segments.length ? segments.join(' · ') : null;
  }

  sendStepNotificationEmail(
    task: { id: string; title: string; notifyOnComplete?: boolean; notifyEmails?: string[] },
    status: string,
    playbookName: string,
    opts: {
      output?: string;
      error?: string;
      playbookId?: string;
      executionId?: string;
      executionSummary?: string;
    } = {},
  ): void {
    if (!task.notifyOnComplete || !task.notifyEmails?.length) return;
    if (!this.emailService.isAvailable()) return;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const statusColor =
      status === 'completed' ? '#22c55e' : status === 'failed' ? '#ef4444' : '#eab308';
    const safeTitle = esc(task.title);
    const safeName = esc(playbookName);

    const subject = `Playbook step "${task.title}" — ${statusLabel}`;

    const errorRow = opts.error
      ? `<tr><td style="padding:8px 16px;color:#ef4444;" colspan="2"><strong>Error:</strong> ${esc(opts.error)}</td></tr>`
      : '';

    const rawOutput = opts.output || '';
    const truncated = rawOutput.length > 5000;
    const outputPreview = truncated ? rawOutput.slice(0, 5000) : rawOutput;
    const outputRow = outputPreview
      ? `<tr><td colspan="2" style="padding:12px 16px;">
<div style="font-size:11px;color:#6b7280;margin-bottom:4px;font-weight:600;">Result</div>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${nl2br(outputPreview)}${truncated ? '<br><em style="color:#9ca3af;">… truncated</em>' : ''}</div>
</td></tr>`
      : '';

    const detailUrl =
      opts.playbookId && opts.executionId
        ? this.buildExecutionDetailUrl(opts.playbookId, opts.executionId)
        : null;
    const summaryHtml = opts.executionSummary
      ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;"><strong>Execution summary</strong><br/>${esc(opts.executionSummary)}</p>`
      : '';
    const detailLinkHtml = detailUrl
      ? `<p style="margin:0;font-size:13px;"><a href="${esc(detailUrl)}">View execution details</a></p>`
      : '';
    const executionBlock =
      summaryHtml || detailLinkHtml
        ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">${summaryHtml}${detailLinkHtml}</div>`
        : '';

    const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
<h2 style="margin:0 0 16px;">Step Notification</h2>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:8px 16px;color:#6b7280;">Playbook</td><td style="padding:8px 16px;font-weight:600;">${safeName}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Step</td><td style="padding:8px 16px;font-weight:600;">${safeTitle}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Status</td><td style="padding:8px 16px;font-weight:600;color:${statusColor};">${statusLabel}</td></tr>
${errorRow}
${outputRow}
</table>
${executionBlock}
<p style="margin-top:16px;font-size:12px;color:#9ca3af;">Sent by YelloStorm Playbook</p>
</div>`;

    const textOutput = outputPreview
      ? `\n\nResult:\n${outputPreview}${truncated ? '\n… truncated' : ''}`
      : '';
    const textSummary = opts.executionSummary
      ? `\n\nExecution summary:\n${opts.executionSummary}`
      : '';
    const textDetail = detailUrl ? `\n\nExecution details: ${detailUrl}` : '';
    const text = `Step "${task.title}" in playbook "${playbookName}" finished with status: ${statusLabel}${opts.error ? `\nError: ${opts.error}` : ''}${textOutput}${textSummary}${textDetail}`;

    this.emailService.send({ to: task.notifyEmails, subject, html, text }).catch((err) => {
      this.logger.warn('Failed to send step notification email', {
        taskId: task.id,
        error: (err as Error).message,
      });
    });
  }

  notifyScheduledRunFinished(
    userId: string,
    executionId: string,
    outcome: 'completed' | 'failed',
    error?: string | null,
  ): void {
    void this.notifyScheduledRunFinishedAsync(userId, executionId, outcome, error);
  }

  async notifyScheduledRunFinishedAsync(
    userId: string,
    executionId: string,
    outcome: 'completed' | 'failed',
    error?: string | null,
  ): Promise<void> {
    try {
      const doc = await this.executionModel
        .findById(executionId)
        .select(
          'executionTrigger playbookId playbookSnapshot executionNumber taskResults.status startedAt completedAt',
        )
        .lean()
        .exec();
      if (!doc || doc.executionTrigger !== 'scheduled') {
        return;
      }
      if (!this.emailService.isAvailable()) {
        return;
      }

      const snapshot = doc.playbookSnapshot as { name?: string } | null | undefined;
      let playbookName = snapshot?.name;
      if (!playbookName && doc.playbookId) {
        const pb = await this.playbookService.findRawById(doc.playbookId.toString());
        playbookName = (pb as { name?: string } | null)?.name;
      }
      playbookName = playbookName || 'Playbook';

      const user = await this.userService.findById(userId);
      const to = user?.email;
      if (!to) {
        return;
      }

      const playbookIdStr = doc.playbookId?.toString() || '';
      const detailUrl = playbookIdStr
        ? this.buildExecutionDetailUrl(playbookIdStr, executionId)
        : '';

      const summaryLine = this.formatExecutionSummaryForEmail({
        executionNumber: doc.executionNumber,
        taskResults: doc.taskResults as Array<{ status?: string }> | undefined,
        startedAt: doc.startedAt as Date | undefined,
        completedAt: doc.completedAt as Date | null | undefined,
      });

      const statusLabel = outcome === 'completed' ? 'Completed' : 'Failed';
      const esc = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const subject = `[YelloStorm] Scheduled playbook "${playbookName}" — ${statusLabel}`;

      const errorBlock =
        outcome === 'failed' && error
          ? `<tr><td colspan="2" style="padding:8px 16px;color:#ef4444;"><strong>Error:</strong> ${esc(error)}</td></tr>`
          : '';

      const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
<h2 style="margin:0 0 16px;">Scheduled run finished</h2>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:8px 16px;color:#6b7280;">Playbook</td><td style="padding:8px 16px;font-weight:600;">${esc(playbookName)}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Status</td><td style="padding:8px 16px;font-weight:600;">${esc(statusLabel)}</td></tr>
${errorBlock}
</table>
${
  summaryLine
    ? `<p style="margin-top:14px;font-size:13px;color:#4b5563;line-height:1.5;"><strong>Summary</strong><br/>${esc(
        summaryLine,
      )}</p>`
    : ''
}
${
  detailUrl
    ? `<p style="margin-top:12px;"><a href="${esc(detailUrl)}">View execution details</a></p>`
    : ''
}
<p style="margin-top:16px;font-size:12px;color:#9ca3af;">Sent by YelloStorm Playbook</p>
</div>`;

      const text = `Scheduled playbook "${playbookName}" finished: ${statusLabel}${
        error ? `\nError: ${error}` : ''
      }${summaryLine ? `\n\nSummary: ${summaryLine}` : ''}${detailUrl ? `\n\nDetails: ${detailUrl}` : ''}`;

      await this.emailService.send({ to: [to], subject, html, text });
    } catch (err) {
      this.logger.warn('Failed to send scheduled execution notification email', {
        executionId,
        error: (err as Error).message,
      });
    }
  }
}
