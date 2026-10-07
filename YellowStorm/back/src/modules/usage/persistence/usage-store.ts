import type { PlanRecord } from './plan.store';
import type { RecordUsageData } from '../interfaces/usage.interface';

export interface UsageWindowRecord {
  id: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  windowHours: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  planId?: string;
  planSlug?: string;
  tokenLimitAtCreation?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageHistoryResult {
  records: UsageWindowRecord[];
  total: number;
  summary: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalRequests: number;
    minDate: Date | null;
    maxDate: Date | null;
  };
}

export interface UsageAnalyticsResult {
  totalTokens: { input: number; output: number; total: number };
  tokensByModel: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requestCount: number;
  }[];
  averageTokensPerConversation: number;
  usageOverTime: { date: string; count: number }[];
  errorRates: {
    model: string;
    totalRequests: number;
    failedRequests: number;
    errorRate: number;
  }[];
}

export interface UsageStore {
  getOrCreateCurrentWindow(userId: string, plan: PlanRecord): Promise<UsageWindowRecord>;
  record(data: RecordUsageData, plan: PlanRecord): Promise<UsageWindowRecord>;
  getHistory(
    userId: string,
    options: { startDate?: Date; endDate?: Date; limit: number; skip: number },
  ): Promise<UsageHistoryResult>;
  getAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy?: 'day' | 'week' | 'month',
  ): Promise<UsageAnalyticsResult>;
  deleteLogsBefore(cutoff: Date, limit: number): Promise<number>;
}
