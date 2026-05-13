/**
 * Time-series data point
 */
export interface TimeSeriesDataPoint {
  date: string;
  count: number;
}

/**
 * User analytics response
 */
export interface UserAnalyticsResponse {
  totalConsentingUsers: number;
  newUsersOverTime: TimeSeriesDataPoint[];
  verificationStatus: {
    verified: number;
    unverified: number;
  };
  profileCompletion: {
    complete: number;
    incomplete: number;
  };
}

/**
 * Token usage by model breakdown
 */
export interface TokensByModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Usage analytics response
 */
export interface UsageAnalyticsResponse {
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  tokensByModel: TokensByModel[];
  averageTokensPerConversation: number;
  usageOverTime: TimeSeriesDataPoint[];
  errorRates: {
    model: string;
    totalRequests: number;
    failedRequests: number;
    errorRate: number;
  }[];
}

/**
 * Component type distribution
 */
export interface ComponentTypeDistribution {
  type: string;
  count: number;
  percentage: number;
}

/**
 * Conversation analytics response
 */
export interface ConversationAnalyticsResponse {
  totalConversations: number;
  messagesPerConversation: {
    average: number;
    min: number;
    max: number;
  };
  conversationsOverTime: TimeSeriesDataPoint[];
  componentTypeDistribution: ComponentTypeDistribution[];
  averageConversationDurationMs: number;
}

/**
 * Feedback distribution
 */
export interface FeedbackDistribution {
  likes: number;
  dislikes: number;
  none: number;
}

/**
 * Report counts by category
 */
export interface ReportsByCategory {
  category: string;
  count: number;
}

/**
 * Quality analytics response
 */
export interface QualityAnalyticsResponse {
  feedbackDistribution: FeedbackDistribution;
  feedbackRate: number;
  reportsByCategory: ReportsByCategory[];
  totalReports: number;
  regenerationRate: number;
}

/**
 * Summary dashboard response
 */
export interface SummaryAnalyticsResponse {
  users: {
    totalConsenting: number;
    newThisPeriod: number;
    verifiedPercentage: number;
  };
  usage: {
    totalTokens: number;
    averagePerConversation: number;
    topModel: string | null;
  };
  conversations: {
    total: number;
    averageMessages: number;
    newThisPeriod: number;
  };
  quality: {
    feedbackRate: number;
    likePercentage: number;
    totalReports: number;
  };
  periodStart: string;
  periodEnd: string;
}
