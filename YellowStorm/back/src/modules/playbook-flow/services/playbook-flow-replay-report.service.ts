import { Injectable } from '@nestjs/common';
import {
  ReplayRunReportRepository,
  toReplayRunReportJson,
  type FlowReplayRunReportRecord,
  type NewReplayRunReport,
  type ReplayRunReportLookupFilter,
  type ReplayRunReportPatch,
} from '../persistence/replay-run-report.repository';

export interface ReplayRunReportLookup {
  _id: string;
  executionId: string;
  flowId: string;
  taskId: string;
  iteration: number;
  replayId: string;
  validationVersion: number;
}

/** Fields removed with the replay eligibility gate; legacy documents may still store them. */
const LEGACY_ELIGIBILITY_FIELDS = [
  'applied',
  'confidenceScore',
  'confidenceFactors',
  'invalidationReasons',
  'appliedSections',
  'skippedSections',
] as const;

function sanitizeLegacyReportRecord(record: Record<string, unknown>): Record<string, unknown> {
  for (const field of LEGACY_ELIGIBILITY_FIELDS) {
    delete record[field];
  }
  if (record.verdict === 'skipped') {
    record.verdict = 'unknown';
  }
  if (Array.isArray(record.verdictReasons)) {
    record.verdictReasons = (record.verdictReasons as unknown[]).filter((reason) => reason !== 'replay_not_applied');
  }
  if (Array.isArray(record.blockedBy)) {
    record.blockedBy = (record.blockedBy as unknown[]).filter((reason) => reason !== 'confidence_below_threshold');
  }
  return record;
}

@Injectable()
export class PlaybookFlowReplayReportService {
  constructor(private readonly replayRunReportRepository: ReplayRunReportRepository) {}

  async createReport(payload: NewReplayRunReport): Promise<FlowReplayRunReportRecord> {
    return this.replayRunReportRepository.create(payload);
  }

  async updateReport(reportId: string, fields: ReplayRunReportPatch): Promise<void> {
    await this.replayRunReportRepository.update(reportId, fields);
  }

  async findLatestReportRecord(filter: ReplayRunReportLookupFilter): Promise<Record<string, unknown> | null> {
    const record = await this.replayRunReportRepository.findLatest(filter);
    return record ? sanitizeLegacyReportRecord({ ...record }) : null;
  }

  async listReports(params: {
    flowId: string;
    taskId: string;
    executionId?: string;
    iteration?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const records = await this.replayRunReportRepository.list({
      flowId: params.flowId,
      taskId: params.taskId,
      executionId: params.executionId || undefined,
      iteration: typeof params.iteration === 'number' ? params.iteration : undefined,
      offset: params.offset ?? 0,
      limit: Math.min(params.limit ?? 20, 50),
    });
    return records.map((record) => sanitizeLegacyReportRecord({ ...toReplayRunReportJson(record) }));
  }

  async findLatestScoresForReplays(replayIds: string[]): Promise<Map<string, number>> {
    if (replayIds.length === 0) return new Map();
    return this.replayRunReportRepository.latestScoresForReplays(replayIds);
  }

  async findLatestReportForExecutionTask(
    executionId: string,
    taskId: string,
    iteration?: number,
  ): Promise<ReplayRunReportLookup | null> {
    const report = await this.replayRunReportRepository.findLatest({
      executionId,
      taskId,
      ...(typeof iteration === 'number' ? { iteration } : {}),
    });
    if (!report) {
      return null;
    }

    return {
      _id: report.id,
      executionId: report.executionId,
      flowId: report.flowId,
      taskId: report.taskId,
      iteration: Number(report.iteration ?? 0),
      replayId: report.replayId,
      validationVersion: report.validationVersion,
    };
  }
}
