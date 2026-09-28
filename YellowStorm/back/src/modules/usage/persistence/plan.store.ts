/**
 * Row shape for catalog.plans (plan 1B.3.2). PlanRecord replaces the
 * former Mongoose PlanDocument across usage stores and the limit guard.
 */
export interface PlanRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
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
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
