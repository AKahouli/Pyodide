import type { CreatePlanData, UpdatePlanData } from '../interfaces/plan.interface';

/**
 * Store port for catalog.plans (plan 1B.3.2). PlanRecord replaces the
 * former Mongoose PlanDocument across usage stores and the limit guard.
 */
export const PLAN_STORE = Symbol('PLAN_STORE');

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

export interface PlanStore {
  findActive(): Promise<PlanRecord[]>;
  findAll(): Promise<PlanRecord[]>;
  findById(id: string): Promise<PlanRecord | null>;
  findBySlug(slug: string): Promise<PlanRecord | null>;
  /** The flagged default (is_default + active). */
  findFlaggedDefault(): Promise<PlanRecord | null>;
  /** INSERT … ON CONFLICT (slug) DO NOTHING — idempotent seeding. */
  seed(data: CreatePlanData): Promise<void>;
  /** Create; clears other defaults in the same transaction when isDefault. */
  insert(data: CreatePlanData): Promise<PlanRecord | null>;
  /** Partial update; clears other defaults in the same transaction when isDefault. */
  update(id: string, patch: UpdatePlanData): Promise<PlanRecord | null>;
}
