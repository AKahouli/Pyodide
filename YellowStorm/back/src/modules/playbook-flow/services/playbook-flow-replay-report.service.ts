import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowReplayRunReport,
  FlowReplayRunReportDocument,
} from '../schemas/playbook-flow-replay-run-report.schema';

export interface ReplayRunReportLookup {
  _id: string;
  executionId: string;
  flowId: string;
  taskId: string;
  iteration: number;
  replayId: string;
  validationVersion: number;
  applied: boolean;
}

@Injectable()
export class PlaybookFlowReplayReportService {
  constructor(
    @InjectModel(FlowReplayRunReport.name)
    private readonly replayRunReportModel: Model<FlowReplayRunReportDocument>,
  ) {}

  async createReport(payload: Record<string, unknown>): Promise<FlowReplayRunReportDocument> {
    const [report] = await this.replayRunReportModel.create([payload]);
    return report;
  }

  async updateReport(reportId: unknown, fields: Record<string, unknown>): Promise<void> {
    await this.replayRunReportModel.updateOne(
      { _id: reportId },
      { $set: fields },
    ).exec();
  }

  async findLatestReportRecord(filter: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.replayRunReportModel
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<Record<string, unknown> | null>;
  }

  async listReports(params: {
    flowId: string;
    taskId: string;
    executionId?: string;
    iteration?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const filter: Record<string, unknown> = {
      flowId: params.flowId,
      taskId: params.taskId,
    };
    if (params.executionId) {
      filter.executionId = params.executionId;
    }
    if (typeof params.iteration === 'number') {
      filter.iteration = params.iteration;
    }
    const docs = await this.replayRunReportModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(params.offset ?? 0)
      .limit(Math.min(params.limit ?? 20, 50))
      .exec();
    return docs.map((doc) => doc.toJSON());
  }

  async findLatestScoresForReplays(replayIds: string[]): Promise<Map<string, number>> {
    if (replayIds.length === 0) return new Map();
    const results = await this.replayRunReportModel
      .aggregate([
        { $match: { replayId: { $in: replayIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$replayId', overallScore: { $first: '$overallScore' } } },
      ])
      .exec();
    const map = new Map<string, number>();
    for (const row of results) {
      if (typeof row.overallScore === 'number') {
        map.set(row._id, row.overallScore);
      }
    }
    return map;
  }

  async findLatestReportForExecutionTask(
    executionId: string,
    taskId: string,
    iteration?: number,
  ): Promise<ReplayRunReportLookup | null> {
    const filter: Record<string, unknown> = { executionId, taskId };
    if (typeof iteration === 'number') {
      filter.iteration = iteration;
    }
    const report = await this.replayRunReportModel
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!report) {
      return null;
    }

    return {
      _id: (report as unknown as Record<string, unknown>)._id as string,
      executionId: report.executionId,
      flowId: report.flowId,
      taskId: report.taskId,
      iteration: Number(report.iteration ?? 0),
      replayId: report.replayId,
      validationVersion: report.validationVersion,
      applied: report.applied,
    };
  }
}
