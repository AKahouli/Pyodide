import { PlanTier } from '../schemas/plan.schema';

/**
 * Plan response interface for API responses
 */
export interface PlanResponse {
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
 * Plan summary for user-facing responses
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
 * Data for creating a new plan
 */
export interface CreatePlanData {
  name: string;
  slug: string;
  description?: string;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  features?: string[];
  priority: number;
  priceMonthly?: number;
  priceYearly?: number;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  maxWorkspaces?: number;
  workspaceStorageBytes?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Data for updating a plan
 */
export interface UpdatePlanData {
  name?: string;
  description?: string;
  tokenLimit?: number;
  windowHours?: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  features?: string[];
  priority?: number;
  priceMonthly?: number;
  priceYearly?: number;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  maxWorkspaces?: number;
  workspaceStorageBytes?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Default plans configuration
 */
export const DEFAULT_PLANS: CreatePlanData[] = [
  {
    name: 'Free',
    slug: PlanTier.FREE,
    description: 'Free tier with limited usage',
    tokenLimit: 10000, // 10k tokens per day
    windowHours: 24,
    requestsPerMinute: 10,
    maxTokensPerRequest: 2000,
    features: ['basic_chat'],
    priority: 0,
    priceMonthly: 0,
    priceYearly: 0,
    isActive: true,
    isDefault: false,
    displayOrder: 0,
    maxWorkspaces: 3,
    workspaceStorageBytes: 100 * 1024 * 1024, // 100MB per workspace
  },
  {
    name: 'Basic',
    slug: PlanTier.BASIC,
    description: 'Basic tier for individual users',
    tokenLimit: 100000, // 100k tokens per day
    windowHours: 24,
    requestsPerMinute: 30,
    maxTokensPerRequest: 4000,
    features: ['basic_chat', 'history', 'export'],
    priority: 1,
    priceMonthly: 9.99,
    priceYearly: 99.99,
    isActive: true,
    isDefault: false,
    displayOrder: 1,
    maxWorkspaces: 10,
    workspaceStorageBytes: 2 * 1024 * 1024 * 1024, // 2GB per workspace
  },
  {
    name: 'Enterprise',
    slug: PlanTier.ENTERPRISE,
    description: 'Enterprise tier for teams and businesses',
    tokenLimit: 1000000, // 1M tokens per day
    windowHours: 24,
    requestsPerMinute: 60,
    maxTokensPerRequest: 8000,
    features: ['basic_chat', 'history', 'export', 'api_access', 'priority_support', 'analytics'],
    priority: 2,
    priceMonthly: 49.99,
    priceYearly: 499.99,
    isActive: true,
    isDefault: false,
    displayOrder: 2,
    maxWorkspaces: 50,
    workspaceStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB per workspace
  },
  {
    name: 'Unlimited',
    slug: PlanTier.UNLIMITED,
    description: 'Unlimited usage for power users',
    tokenLimit: -1, // Unlimited
    windowHours: 24,
    requestsPerMinute: -1, // Unlimited
    maxTokensPerRequest: -1, // Unlimited
    features: ['basic_chat', 'history', 'export', 'api_access', 'priority_support', 'analytics', 'unlimited'],
    priority: 3,
    priceMonthly: 199.99,
    priceYearly: 1999.99,
    isActive: true,
    isDefault: true,
    displayOrder: 3,
    maxWorkspaces: -1, // Unlimited
    workspaceStorageBytes: 100 * 1024 * 1024 * 1024, // 100GB per workspace
  },
];
