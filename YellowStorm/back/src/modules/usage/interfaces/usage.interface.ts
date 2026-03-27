import { UsageType } from '../schemas/usage.schema';
import { PlanSummary } from './plan.interface';

/**
 * Current usage status for a user
 */
export interface UsageStatus {
  /** Current window information */
  window: {
    start: Date;
    end: Date;
    hoursRemaining: number;
  };
  /** Token usage in current window */
  tokens: {
    input: number;
    output: number;
    total: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    isUnlimited: boolean;
  };
  /** Request count in current window */
  requests: {
    count: number;
    limit: number;
    remaining: number;
    isUnlimited: boolean;
  };
  /** User's current plan */
  plan: PlanSummary;
  /** Whether user has exceeded their limit */
  isLimitExceeded: boolean;
  /** Time until limit resets (ISO string) */
  resetsAt: string;
}

/**
 * Usage response for API
 */
export interface UsageResponse {
  id: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  windowHours: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  planSlug?: string;
  tokenLimitAtCreation?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data for recording usage
 */
export interface RecordUsageData {
  userId: string;
  inputTokens: number;
  outputTokens: number;
  usageType?: UsageType;
  modelName?: string;
  conversationId?: string;
  endpoint?: string;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Usage history query parameters
 */
export interface UsageHistoryQuery {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  skip?: number;
}

/**
 * Usage history response
 */
export interface UsageHistoryResponse {
  records: UsageResponse[];
  total: number;
  summary: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalRequests: number;
    periodStart: string;
    periodEnd: string;
  };
}

/**
 * Usage analytics data
 */
export interface UsageAnalytics {
  daily: DailyUsage[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requestCount: number;
  };
  averages: {
    tokensPerDay: number;
    requestsPerDay: number;
    tokensPerRequest: number;
  };
}

/**
 * Daily usage breakdown
 */
export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Usage check result
 */
export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
  isUnlimited: boolean;
}
