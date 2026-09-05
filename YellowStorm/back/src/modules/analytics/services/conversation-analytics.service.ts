import { Inject, Injectable } from '@nestjs/common';
import type { GroupByPeriod } from '../dto';
import type { ConversationAnalyticsResponse, QualityAnalyticsResponse } from '../interfaces';
import {
  CONVERSATION_ANALYTICS_STORE,
  type ConversationAnalyticsStore,
} from '@modules/conversation/persistence/conversation-analytics-store';

@Injectable()
export class ConversationAnalyticsService {
  constructor(
    @Inject(CONVERSATION_ANALYTICS_STORE)
    private readonly store: ConversationAnalyticsStore,
  ) {}

  getConversationAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy?: GroupByPeriod,
  ): Promise<ConversationAnalyticsResponse> {
    return this.store.getConversationAnalytics(consentingUserIds, dateFrom, dateTo, groupBy);
  }

  getQualityAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<QualityAnalyticsResponse> {
    return this.store.getQualityAnalytics(consentingUserIds, dateFrom, dateTo);
  }
}
