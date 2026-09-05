import type { GroupByPeriod } from '@modules/analytics/dto';
import type {
  ConversationAnalyticsResponse,
  QualityAnalyticsResponse,
} from '@modules/analytics/interfaces';

export const CONVERSATION_ANALYTICS_STORE = Symbol('CONVERSATION_ANALYTICS_STORE');

export interface ConversationAnalyticsStore {
  getConversationAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy?: GroupByPeriod,
  ): Promise<ConversationAnalyticsResponse>;
  getQualityAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<QualityAnalyticsResponse>;
}
