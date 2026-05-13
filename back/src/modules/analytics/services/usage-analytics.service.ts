import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import { UsageLog, UsageLogDocument } from '@modules/usage/schemas/usage-log.schema';
import { LoggerService } from '@modules/logger';
import { GroupByPeriod } from '../dto';
import {
  UsageAnalyticsResponse,
  TokensByModel,
  TimeSeriesDataPoint,
} from '../interfaces';

@Injectable()
export class UsageAnalyticsService {
  constructor(
    @InjectModel(UsageLog.name)
    private readonly usageLogModel: Model<UsageLogDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UsageAnalyticsService');
  }

  /**
   * Get usage analytics for consenting users
   */
  async getUsageAnalytics(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<UsageAnalyticsResponse> {
    const matchStage: Record<string, unknown> = {
      userId: { $in: consentingUserIds },
    };

    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) {
        (matchStage.createdAt as Record<string, unknown>).$gte = dateFrom;
      }
      if (dateTo) {
        (matchStage.createdAt as Record<string, unknown>).$lte = dateTo;
      }
    }

    // Get total tokens
    const totalTokens = await this.getTotalTokens(matchStage);

    // Get tokens by model
    const tokensByModel = await this.getTokensByModel(matchStage);

    // Get average tokens per conversation
    const averageTokensPerConversation =
      await this.getAverageTokensPerConversation(matchStage);

    // Get usage over time
    const usageOverTime = await this.getUsageOverTime(matchStage, groupBy);

    // Get error rates by model
    const errorRates = await this.getErrorRates(matchStage);

    return {
      totalTokens,
      tokensByModel,
      averageTokensPerConversation,
      usageOverTime,
      errorRates,
    };
  }

  private async getTotalTokens(
    matchStage: Record<string, unknown>,
  ): Promise<{ input: number; output: number; total: number }> {
    const result = await this.usageLogModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          input: { $sum: '$inputTokens' },
          output: { $sum: '$outputTokens' },
          total: { $sum: '$totalTokens' },
        },
      },
    ]);

    return result[0] || { input: 0, output: 0, total: 0 };
  }

  private async getTokensByModel(
    matchStage: Record<string, unknown>,
  ): Promise<TokensByModel[]> {
    const pipeline: PipelineStage[] = [
      { $match: { ...matchStage, modelName: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$modelName',
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          requestCount: { $sum: 1 },
        },
      },
      { $sort: { totalTokens: -1 as const } },
      {
        $project: {
          _id: 0,
          model: '$_id',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 1,
          requestCount: 1,
        },
      },
    ];
    return this.usageLogModel.aggregate<TokensByModel>(pipeline);
  }

  private async getAverageTokensPerConversation(
    matchStage: Record<string, unknown>,
  ): Promise<number> {
    const result = await this.usageLogModel.aggregate([
      {
        $match: {
          ...matchStage,
          conversationId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$conversationId',
          totalTokens: { $sum: '$totalTokens' },
        },
      },
      {
        $group: {
          _id: null,
          average: { $avg: '$totalTokens' },
        },
      },
    ]);

    return Math.round(result[0]?.average || 0);
  }

  private async getUsageOverTime(
    matchStage: Record<string, unknown>,
    groupBy: GroupByPeriod,
  ): Promise<TimeSeriesDataPoint[]> {
    const dateFormat = this.getDateFormat(groupBy);

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: '$createdAt' },
          },
          count: { $sum: '$totalTokens' },
        },
      },
      { $sort: { _id: 1 as const } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
        },
      },
    ];
    return this.usageLogModel.aggregate<TimeSeriesDataPoint>(pipeline);
  }

  private async getErrorRates(
    matchStage: Record<string, unknown>,
  ): Promise<
    {
      model: string;
      totalRequests: number;
      failedRequests: number;
      errorRate: number;
    }[]
  > {
    const pipeline: PipelineStage[] = [
      { $match: { ...matchStage, modelName: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$modelName',
          totalRequests: { $sum: 1 },
          failedRequests: {
            $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] },
          },
        },
      },
      { $sort: { totalRequests: -1 as const } },
      {
        $project: {
          _id: 0,
          model: '$_id',
          totalRequests: 1,
          failedRequests: 1,
          errorRate: {
            $cond: [
              { $eq: ['$totalRequests', 0] },
              0,
              {
                $multiply: [
                  { $divide: ['$failedRequests', '$totalRequests'] },
                  100,
                ],
              },
            ],
          },
        },
      },
    ];
    const result = await this.usageLogModel.aggregate<{
      model: string;
      totalRequests: number;
      failedRequests: number;
      errorRate: number;
    }>(pipeline);

    return result.map((r) => ({
      ...r,
      errorRate: Math.round(r.errorRate * 100) / 100,
    }));
  }

  private getDateFormat(groupBy: GroupByPeriod): string {
    switch (groupBy) {
      case GroupByPeriod.DAY:
        return '%Y-%m-%d';
      case GroupByPeriod.WEEK:
        return '%Y-W%V';
      case GroupByPeriod.MONTH:
        return '%Y-%m';
      default:
        return '%Y-%m-%d';
    }
  }
}
