/**
 * Usage Module Types
 */

/**
 * Plan information
 */
export interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute: number;
  maxTokensPerRequest: number;
  features: string[];
  priority: number;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  maxWorkspaces: number;
  workspaceStorageBytes: number;
  isUnlimited: boolean;
}

/**
 * Plan summary (minimal info)
 */
export interface PlanSummary {
  id: string;
  name: string;
  slug: string;
  tokenLimit: number;
  windowHours: number;
  isUnlimited: boolean;
  features: string[];
  maxWorkspaces: number;
  workspaceStorageBytes: number;
}

/**
 * User's plan info (from user object)
 */
export interface UserPlan {
  id: string;
  slug?: string;
  startedAt?: string;
}

/**
 * Usage window info
 */
export interface UsageWindow {
  start: string;
  end: string;
  hoursRemaining: number;
}

/**
 * Token usage info
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  isUnlimited: boolean;
}

/**
 * Request usage info
 */
export interface RequestUsage {
  count: number;
  limit: number;
  remaining: number;
  isUnlimited: boolean;
}

/**
 * Complete usage status
 */
export interface UsageStatus {
  window: UsageWindow;
  tokens: TokenUsage;
  requests: RequestUsage;
  plan: PlanSummary;
  isLimitExceeded: boolean;
  resetsAt: string;
}

/**
 * Usage history record
 */
export interface UsageRecord {
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
 * Usage history summary
 */
export interface UsageHistorySummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRequests: number;
  periodStart: string;
  periodEnd: string;
}

/**
 * Usage history response
 */
export interface UsageHistoryResponse {
  records: UsageRecord[];
  total: number;
  summary: UsageHistorySummary;
}

/**
 * Usage history query params
 */
export interface UsageHistoryParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

/**
 * Usage context state
 */
export interface UsageState {
  status: UsageStatus | null;
  plans: Plan[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Usage context type
 */
export interface UsageContextType extends UsageState {
  fetchUsageStatus: () => Promise<void>;
  fetchPlans: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

/**
 * Feature display names
 */
export const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  basic_chat: 'Basic Chat',
  history: 'Chat History',
  export: 'Data Export',
  api_access: 'API Access',
  priority_support: 'Priority Support',
  analytics: 'Usage Analytics',
  unlimited: 'Unlimited Usage',
};

/**
 * Plan tier colors
 */
export const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-100 text-slate-800 border-slate-200',
  basic: 'bg-blue-100 text-blue-800 border-blue-200',
  enterprise: 'bg-purple-100 text-purple-800 border-purple-200',
  unlimited: 'bg-amber-100 text-amber-800 border-amber-200',
};

/**
 * Current plan highlight color (redish rose)
 */
export const CURRENT_PLAN_COLOR = ' ring-2 ring-primary';

/**
 * Format bytes to human-readable size for plan display
 */
export function formatStorageSize(bytes: number, unlimitedLabel = 'Unlimited'): string {
  if (bytes === -1) return unlimitedLabel;
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(0)) + ' ' + sizes[i];
}
