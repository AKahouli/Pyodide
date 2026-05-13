import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from '@modules/conversation/schemas/conversation.schema';
import {
  Message,
  MessageDocument,
} from '@modules/conversation/schemas/message.schema';
import {
  Report,
  ReportDocument,
} from '@modules/conversation/schemas/report.schema';
import { LoggerService } from '@modules/logger';
import { GroupByPeriod } from '../dto';
import {
  ConversationAnalyticsResponse,
  QualityAnalyticsResponse,
  TimeSeriesDataPoint,
  ComponentTypeDistribution,
  FeedbackDistribution,
  ReportsByCategory,
} from '../interfaces';

@Injectable()
export class ConversationAnalyticsService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Report.name)
    private readonly reportModel: Model<ReportDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConversationAnalyticsService');
  }

  /**
   * Get conversation analytics for consenting users
   */
  async getConversationAnalytics(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<ConversationAnalyticsResponse> {
    const matchStage: Record<string, unknown> = {
      createdBy: { $in: consentingUserIds },
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

    // Get total conversations
    const totalConversations =
      await this.conversationModel.countDocuments(matchStage);

    // Get messages per conversation stats
    const messagesPerConversation =
      await this.getMessagesPerConversation(matchStage);

    // Get conversations over time
    const conversationsOverTime = await this.getConversationsOverTime(
      matchStage,
      groupBy,
    );

    // Get component type distribution
    const componentTypeDistribution = await this.getComponentTypeDistribution(
      consentingUserIds,
      dateFrom,
      dateTo,
    );

    // Get average conversation duration
    const averageConversationDurationMs =
      await this.getAverageConversationDuration(matchStage);

    return {
      totalConversations,
      messagesPerConversation,
      conversationsOverTime,
      componentTypeDistribution,
      averageConversationDurationMs,
    };
  }

  /**
   * Get quality analytics for consenting users
   */
  async getQualityAnalytics(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<QualityAnalyticsResponse> {
    // Get conversation IDs for consenting users
    const conversationIds = await this.getConversationIds(
      consentingUserIds,
      dateFrom,
      dateTo,
    );

    // Build match stage for messages
    const messageMatchStage: Record<string, unknown> = {
      conversationId: { $in: conversationIds },
      conversationType: 'ai',
    };

    if (dateFrom || dateTo) {
      messageMatchStage.createdAt = {};
      if (dateFrom) {
        (messageMatchStage.createdAt as Record<string, unknown>).$gte =
          dateFrom;
      }
      if (dateTo) {
        (messageMatchStage.createdAt as Record<string, unknown>).$lte = dateTo;
      }
    }

    // Get feedback distribution
    const feedbackDistribution =
      await this.getFeedbackDistribution(messageMatchStage);

    // Get feedback rate
    const feedbackRate = await this.getFeedbackRate(messageMatchStage);

    // Get reports by category
    const reportsByCategory = await this.getReportsByCategory(
      consentingUserIds,
      dateFrom,
      dateTo,
    );

    // Get total reports
    const totalReports = reportsByCategory.reduce((sum, r) => sum + r.count, 0);

    // Get regeneration rate (messages that are edited)
    const regenerationRate = await this.getRegenerationRate(messageMatchStage);

    return {
      feedbackDistribution,
      feedbackRate,
      reportsByCategory,
      totalReports,
      regenerationRate,
    };
  }

  private async getConversationIds(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<Types.ObjectId[]> {
    const matchStage: Record<string, unknown> = {
      createdBy: { $in: consentingUserIds },
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

    const conversations = await this.conversationModel
      .find(matchStage, { _id: 1 })
      .lean();
    return conversations.map((c) => c._id as Types.ObjectId);
  }

  private async getMessagesPerConversation(
    matchStage: Record<string, unknown>,
  ): Promise<{ average: number; min: number; max: number }> {
    const result = await this.conversationModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          average: { $avg: '$messageCount' },
          min: { $min: '$messageCount' },
          max: { $max: '$messageCount' },
        },
      },
    ]);

    return {
      average: Math.round((result[0]?.average || 0) * 100) / 100,
      min: result[0]?.min || 0,
      max: result[0]?.max || 0,
    };
  }

  private async getConversationsOverTime(
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
          count: { $sum: 1 },
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
    return this.conversationModel.aggregate<TimeSeriesDataPoint>(pipeline);
  }

  private async getComponentTypeDistribution(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<ComponentTypeDistribution[]> {
    // Get conversation IDs for consenting users
    const conversationIds = await this.getConversationIds(
      consentingUserIds,
      dateFrom,
      dateTo,
    );

    const matchStage: Record<string, unknown> = {
      conversationId: { $in: conversationIds },
      conversationType: 'ai',
      components: { $exists: true, $ne: [] },
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

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      { $unwind: '$components' },
      {
        $group: {
          _id: '$components.type',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 as const } },
    ];
    const result = await this.messageModel.aggregate<{
      _id: string;
      count: number;
    }>(pipeline);

    const total = result.reduce((sum, r) => sum + r.count, 0);

    return result.map((r) => ({
      type: r._id,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }));
  }

  private async getAverageConversationDuration(
    matchStage: Record<string, unknown>,
  ): Promise<number> {
    const result = await this.conversationModel.aggregate([
      { $match: { ...matchStage, lastMessageAt: { $exists: true } } },
      {
        $project: {
          duration: { $subtract: ['$lastMessageAt', '$createdAt'] },
        },
      },
      {
        $group: {
          _id: null,
          average: { $avg: '$duration' },
        },
      },
    ]);

    return Math.round(result[0]?.average || 0);
  }

  private async getFeedbackDistribution(
    messageMatchStage: Record<string, unknown>,
  ): Promise<FeedbackDistribution> {
    const result = await this.messageModel.aggregate([
      { $match: messageMatchStage },
      {
        $group: {
          _id: '$feedback',
          count: { $sum: 1 },
        },
      },
    ]);

    const likes = result.find((r) => r._id === 'like')?.count || 0;
    const dislikes = result.find((r) => r._id === 'dislike')?.count || 0;
    const none =
      result.find((r) => r._id === null || r._id === undefined)?.count || 0;

    return { likes, dislikes, none };
  }

  private async getFeedbackRate(
    messageMatchStage: Record<string, unknown>,
  ): Promise<number> {
    const totalMessages =
      await this.messageModel.countDocuments(messageMatchStage);
    const messagesWithFeedback = await this.messageModel.countDocuments({
      ...messageMatchStage,
      feedback: { $exists: true, $ne: null },
    });

    if (totalMessages === 0) return 0;
    return Math.round((messagesWithFeedback / totalMessages) * 10000) / 100;
  }

  private async getReportsByCategory(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<ReportsByCategory[]> {
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

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $group: {
          _id: '$reason',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 as const } },
      {
        $project: {
          _id: 0,
          category: '$_id',
          count: 1,
        },
      },
    ];
    return this.reportModel.aggregate<ReportsByCategory>(pipeline);
  }

  private async getRegenerationRate(
    messageMatchStage: Record<string, unknown>,
  ): Promise<number> {
    const totalMessages =
      await this.messageModel.countDocuments(messageMatchStage);
    const editedMessages = await this.messageModel.countDocuments({
      ...messageMatchStage,
      isEdited: true,
    });

    if (totalMessages === 0) return 0;
    return Math.round((editedMessages / totalMessages) * 10000) / 100;
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
