import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { UserAnalyticsService } from './user-analytics.service';
import { UsageAnalyticsService } from './usage-analytics.service';
import { ConversationAnalyticsService } from './conversation-analytics.service';
import { GroupByPeriod } from '../dto';
import {
  UserAnalyticsResponse,
  UsageAnalyticsResponse,
  ConversationAnalyticsResponse,
  QualityAnalyticsResponse,
  SummaryAnalyticsResponse,
} from '../interfaces';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly userAnalyticsService: UserAnalyticsService,
    private readonly usageAnalyticsService: UsageAnalyticsService,
    private readonly conversationAnalyticsService: ConversationAnalyticsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AnalyticsService');
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(
    dateFrom?: string,
    dateTo?: string,
    groupBy?: GroupByPeriod,
  ): Promise<UserAnalyticsResponse> {
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    this.logger.log('Fetching user analytics', { dateFrom, dateTo, groupBy });

    return this.userAnalyticsService.getUserAnalytics(fromDate, toDate, groupBy);
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(
    dateFrom?: string,
    dateTo?: string,
    groupBy?: GroupByPeriod,
  ): Promise<UsageAnalyticsResponse> {
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    this.logger.log('Fetching usage analytics', { dateFrom, dateTo, groupBy });

    const consentingUserIds = await this.userAnalyticsService.getConsentingUserIds();

    return this.usageAnalyticsService.getUsageAnalytics(
      consentingUserIds,
      fromDate,
      toDate,
      groupBy,
    );
  }

  /**
   * Get conversation analytics
   */
  async getConversationAnalytics(
    dateFrom?: string,
    dateTo?: string,
    groupBy?: GroupByPeriod,
  ): Promise<ConversationAnalyticsResponse> {
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    this.logger.log('Fetching conversation analytics', {
      dateFrom,
      dateTo,
      groupBy,
    });

    const consentingUserIds = await this.userAnalyticsService.getConsentingUserIds();

    return this.conversationAnalyticsService.getConversationAnalytics(
      consentingUserIds.map((id) => id.toString()),
      fromDate,
      toDate,
      groupBy,
    );
  }

  /**
   * Get quality analytics
   */
  async getQualityAnalytics(dateFrom?: string, dateTo?: string): Promise<QualityAnalyticsResponse> {
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    this.logger.log('Fetching quality analytics', { dateFrom, dateTo });

    const consentingUserIds = await this.userAnalyticsService.getConsentingUserIds();

    return this.conversationAnalyticsService.getQualityAnalytics(
      consentingUserIds.map((id) => id.toString()),
      fromDate,
      toDate,
    );
  }

  /**
   * Get summary dashboard analytics
   */
  async getSummaryAnalytics(dateFrom?: string, dateTo?: string): Promise<SummaryAnalyticsResponse> {
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    this.logger.log('Fetching summary analytics', { dateFrom, dateTo });

    // Fetch all analytics in parallel
    const [userAnalytics, usageAnalytics, conversationAnalytics, qualityAnalytics] =
      await Promise.all([
        this.getUserAnalytics(dateFrom, dateTo),
        this.getUsageAnalytics(dateFrom, dateTo),
        this.getConversationAnalytics(dateFrom, dateTo),
        this.getQualityAnalytics(dateFrom, dateTo),
      ]);

    // Calculate new users this period
    const newThisPeriod = userAnalytics.newUsersOverTime.reduce(
      (sum, point) => sum + point.count,
      0,
    );

    // Calculate verified percentage
    const totalUsers =
      userAnalytics.verificationStatus.verified + userAnalytics.verificationStatus.unverified;
    const verifiedPercentage =
      totalUsers > 0
        ? Math.round((userAnalytics.verificationStatus.verified / totalUsers) * 10000) / 100
        : 0;

    // Find top model by usage
    const topModel =
      usageAnalytics.tokensByModel.length > 0 ? usageAnalytics.tokensByModel[0].model : null;

    // Calculate new conversations this period
    const newConversationsThisPeriod = conversationAnalytics.conversationsOverTime.reduce(
      (sum, point) => sum + point.count,
      0,
    );

    // Calculate like percentage
    const totalFeedback =
      qualityAnalytics.feedbackDistribution.likes + qualityAnalytics.feedbackDistribution.dislikes;
    const likePercentage =
      totalFeedback > 0
        ? Math.round((qualityAnalytics.feedbackDistribution.likes / totalFeedback) * 10000) / 100
        : 0;

    return {
      users: {
        totalConsenting: userAnalytics.totalConsentingUsers,
        newThisPeriod,
        verifiedPercentage,
      },
      usage: {
        totalTokens: usageAnalytics.totalTokens.total,
        averagePerConversation: usageAnalytics.averageTokensPerConversation,
        topModel,
      },
      conversations: {
        total: conversationAnalytics.totalConversations,
        averageMessages: conversationAnalytics.messagesPerConversation.average,
        newThisPeriod: newConversationsThisPeriod,
      },
      quality: {
        feedbackRate: qualityAnalytics.feedbackRate,
        likePercentage,
        totalReports: qualityAnalytics.totalReports,
      },
      periodStart: fromDate?.toISOString() || new Date(0).toISOString(),
      periodEnd: toDate?.toISOString() || new Date().toISOString(),
    };
  }
}
