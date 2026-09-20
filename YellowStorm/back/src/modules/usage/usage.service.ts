import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Plan, PlanDocument, PlanTier } from './schemas/plan.schema';
import {
  PlanResponse,
  CreatePlanData,
  UpdatePlanData,
  DEFAULT_PLANS,
} from './interfaces/plan.interface';
import {
  UsageStatus,
  UsageResponse,
  RecordUsageData,
  UsageHistoryResponse,
  UsageCheckResult,
} from './interfaces/usage.interface';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  ConflictException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  USAGE_STORE,
  type UsageStore,
  type UsageWindowRecord,
} from './persistence/usage-store';

const USAGE_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const USAGE_LOG_CLEANUP_BATCH_SIZE = 1000;

@Injectable()
export class UsageService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    @Inject(USAGE_STORE) private readonly usageStore: UsageStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UsageService');
  }

  /**
   * Initialize default plans after application bootstrap
   * Using onApplicationBootstrap ensures MongoDB connection is ready
   */
  async onApplicationBootstrap() {
    try {
      await this.seedDefaultPlans();
    } catch (error) {
      this.logger.warn('Failed to seed default plans on startup', { error });
      // Non-fatal - plans can be created manually or will be created on next restart
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredUsageLogs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - USAGE_LOG_RETENTION_MS);
      let deleted: number;
      do {
        deleted = await this.usageStore.deleteLogsBefore(
          cutoff,
          USAGE_LOG_CLEANUP_BATCH_SIZE,
        );
      } while (deleted === USAGE_LOG_CLEANUP_BATCH_SIZE);
    } catch (error) {
      this.logger.error('Failed to clean up expired usage logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Seed default plans if they don't exist
   */
  private async seedDefaultPlans(): Promise<void> {
    for (const planData of DEFAULT_PLANS) {
      const existing = await this.planModel.findOne({ slug: planData.slug });
      if (!existing) {
        await this.planModel.create(planData);
        this.logger.log(`Created default plan: ${planData.name}`);
      }
    }
  }

  // ==================== Plan Management ====================

  /**
   * Get all active plans
   */
  async getActivePlans(): Promise<PlanResponse[]> {
    const plans = await this.planModel
      .find({ isActive: true })
      .sort({ displayOrder: 1 })
      .exec();
    return plans.map((plan) => this.mapPlanToResponse(plan));
  }

  /**
   * Get all plans (including inactive)
   */
  async getAllPlans(): Promise<PlanResponse[]> {
    const plans = await this.planModel.find().sort({ displayOrder: 1 }).exec();
    return plans.map((plan) => this.mapPlanToResponse(plan));
  }

  /**
   * Get plan by ID
   */
  async getPlanById(planId: string): Promise<PlanDocument> {
    const plan = await this.planModel.findById(planId);
    if (!plan) {
      throw new NotFoundException(ErrorCode.PLAN_NOT_FOUND, 'Plan not found');
    }
    return plan;
  }

  /**
   * Get plan by slug
   */
  async getPlanBySlug(slug: string): Promise<PlanDocument> {
    const plan = await this.planModel.findOne({ slug });
    if (!plan) {
      throw new NotFoundException(ErrorCode.PLAN_NOT_FOUND, 'Plan not found');
    }
    return plan;
  }

  /**
   * Get default plan
   */
  async getDefaultPlan(): Promise<PlanDocument> {
    // Prefer the unlimited plan for new user registrations
    let plan = await this.planModel.findOne({ slug: PlanTier.UNLIMITED, isActive: true });
    if (!plan) {
      // Fallback to any plan marked as default
      plan ??= await this.planModel.findOne({ isDefault: true, isActive: true });
    }
    if (!plan) {
      throw new NotFoundException(ErrorCode.PLAN_NOT_FOUND, 'No default plan configured');
    }
    return plan;
  }

  /**
   * Create a new plan
   */
  async createPlan(data: CreatePlanData): Promise<PlanDocument> {
    const existing = await this.planModel.findOne({ slug: data.slug });
    if (existing) {
      throw new ConflictException(ErrorCode.PLAN_ALREADY_EXISTS, 'A plan with this slug already exists');
    }

    // If this is set as default, unset other defaults
    if (data.isDefault) {
      await this.planModel.updateMany({ isDefault: true }, { isDefault: false });
    }

    const plan = await this.planModel.create(data);
    this.logger.log('Plan created', { planId: plan._id, slug: plan.slug });
    return plan;
  }

  /**
   * Update a plan
   */
  async updatePlan(planId: string, data: UpdatePlanData): Promise<PlanDocument> {
    const plan = await this.getPlanById(planId);

    // If this is set as default, unset other defaults
    if (data.isDefault) {
      await this.planModel.updateMany(
        { _id: { $ne: planId }, isDefault: true },
        { isDefault: false },
      );
    }

    // Only assign defined values to avoid overwriting with undefined
    const definedData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    Object.assign(plan, definedData);
    await plan.save();

    this.logger.log('Plan updated', { planId: plan._id, slug: plan.slug });
    return plan;
  }

  /**
   * Delete a plan (soft delete by setting isActive to false)
   */
  async deletePlan(planId: string): Promise<void> {
    const plan = await this.getPlanById(planId);

    if (plan.isDefault) {
      throw new ConflictException(ErrorCode.PLAN_INVALID, 'Cannot delete the default plan');
    }

    plan.isActive = false;
    await plan.save();

    this.logger.log('Plan deactivated', { planId: plan._id, slug: plan.slug });
  }

  // ==================== Usage Tracking ====================

  /**
   * Get or create the current usage window for a user
   */
  async getOrCreateCurrentWindow(
    userId: string,
    plan: PlanDocument,
  ): Promise<UsageWindowRecord> {
    return this.usageStore.getOrCreateCurrentWindow(userId, plan);
  }

  /**
   * Record usage for a user
   */
  async recordUsage(data: RecordUsageData): Promise<UsageWindowRecord> {
    // Get user's plan (we need to look this up or have it passed in)
    // For now, we'll use the default plan if not found
    const plan = await this.getDefaultPlan();

    const updatedUsage = await this.usageStore.record(data, plan);

    this.logger.debug('Usage recorded', {
      userId: data.userId,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
    });

    return updatedUsage;
  }

  /**
   * Record usage for a user with their specific plan
   */
  async recordUsageWithPlan(
    data: RecordUsageData,
    plan: PlanDocument,
  ): Promise<UsageWindowRecord> {
    return this.usageStore.record(data, plan);
  }

  /**
   * Check if user can make a request (hasn't exceeded limits)
   */
  async checkUsageLimit(
    userId: string,
    plan: PlanDocument,
    requestedTokens?: number,
  ): Promise<UsageCheckResult> {
    // Unlimited plan
    if (plan.tokenLimit === -1) {
      return {
        allowed: true,
        currentUsage: 0,
        limit: -1,
        remaining: -1,
        resetsAt: new Date(),
        isUnlimited: true,
      };
    }

    const usage = await this.getOrCreateCurrentWindow(userId, plan);

    const currentUsage = usage.totalTokens;
    const limit = plan.tokenLimit;
    const remaining = Math.max(0, limit - currentUsage);

    // Check if adding requested tokens would exceed limit
    const wouldExceed = requestedTokens
      ? currentUsage + requestedTokens > limit
      : currentUsage >= limit;

    return {
      allowed: !wouldExceed,
      reason: wouldExceed ? 'Token limit exceeded for current window' : undefined,
      currentUsage,
      limit,
      remaining,
      resetsAt: usage.windowEnd,
      isUnlimited: false,
    };
  }

  /**
   * Get current usage status for a user
   */
  async getUsageStatus(userId: string, plan: PlanDocument): Promise<UsageStatus> {
    const usage = await this.getOrCreateCurrentWindow(userId, plan);
    const now = new Date();

    const hoursRemaining = Math.max(
      0,
      (usage.windowEnd.getTime() - now.getTime()) / (1000 * 60 * 60),
    );

    const isUnlimited = plan.tokenLimit === -1;
    const limit = plan.tokenLimit;
    const remaining = isUnlimited ? -1 : Math.max(0, limit - usage.totalTokens);
    const percentUsed = isUnlimited ? 0 : Math.min(100, (usage.totalTokens / limit) * 100);

    const requestsUnlimited = plan.requestsPerMinute === -1;

    return {
      window: {
        start: usage.windowStart,
        end: usage.windowEnd,
        hoursRemaining: Math.round(hoursRemaining * 100) / 100,
      },
      tokens: {
        input: usage.inputTokens,
        output: usage.outputTokens,
        total: usage.totalTokens,
        limit,
        remaining,
        percentUsed: Math.round(percentUsed * 100) / 100,
        isUnlimited,
      },
      requests: {
        count: usage.requestCount,
        limit: plan.requestsPerMinute,
        remaining: requestsUnlimited ? -1 : plan.requestsPerMinute,
        isUnlimited: requestsUnlimited,
      },
      plan: {
        id: plan._id.toString(),
        name: plan.name,
        slug: plan.slug,
        tokenLimit: plan.tokenLimit,
        windowHours: plan.windowHours,
        isUnlimited,
        features: plan.features,
        maxWorkspaces: plan.maxWorkspaces,
        workspaceStorageBytes: plan.workspaceStorageBytes,
      },
      isLimitExceeded: !isUnlimited && usage.totalTokens >= limit,
      resetsAt: usage.windowEnd.toISOString(),
    };
  }

  /**
   * Get usage history for a user
   */
  async getUsageHistory(
    userId: string,
    options: { startDate?: Date; endDate?: Date; limit?: number; skip?: number } = {},
  ): Promise<UsageHistoryResponse> {
    const { startDate, endDate, limit = 30, skip = 0 } = options;

    const { records, total, summary } = await this.usageStore.getHistory(userId, {
      startDate,
      endDate,
      limit,
      skip,
    });

    return {
      records: records.map((r) => this.mapUsageToResponse(r)),
      total,
      summary: {
        totalInputTokens: summary.totalInputTokens,
        totalOutputTokens: summary.totalOutputTokens,
        totalTokens: summary.totalTokens,
        totalRequests: summary.totalRequests,
        periodStart: summary.minDate?.toISOString() ?? new Date().toISOString(),
        periodEnd: summary.maxDate?.toISOString() ?? new Date().toISOString(),
      },
    };
  }

  // ==================== Helpers ====================

  private mapPlanToResponse(plan: PlanDocument): PlanResponse {
    return {
      id: plan._id.toString(),
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      tokenLimit: plan.tokenLimit,
      windowHours: plan.windowHours,
      requestsPerMinute: plan.requestsPerMinute,
      maxTokensPerRequest: plan.maxTokensPerRequest,
      features: plan.features,
      priority: plan.priority,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      currency: plan.currency,
      isActive: plan.isActive,
      isDefault: plan.isDefault,
      displayOrder: plan.displayOrder,
      maxWorkspaces: plan.maxWorkspaces,
      workspaceStorageBytes: plan.workspaceStorageBytes,
      isUnlimited: plan.tokenLimit === -1,
    };
  }

  private mapUsageToResponse(usage: UsageWindowRecord): UsageResponse {
    return {
      id: usage.id,
      userId: usage.userId,
      windowStart: usage.windowStart.toISOString(),
      windowEnd: usage.windowEnd.toISOString(),
      windowHours: usage.windowHours,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      requestCount: usage.requestCount,
      planSlug: usage.planSlug,
      tokenLimitAtCreation: usage.tokenLimitAtCreation,
      createdAt: usage.createdAt.toISOString(),
      updatedAt: usage.updatedAt.toISOString(),
    };
  }

  /**
   * Ensure user has a plan, assign default if not
   */
  async ensureUserHasPlan(userId: string, currentPlanId?: string | Types.ObjectId): Promise<PlanDocument> {
    if (currentPlanId) {
      try {
        return await this.getPlanById(currentPlanId.toString());
      } catch {
        // Plan not found, fall through to default
      }
    }
    return this.getDefaultPlan();
  }

  /**
   * Assign a plan to a user
   * This is a helper that should be called when updating the user document
   */
  getPlanAssignmentData(plan: PlanDocument): {
    planId: Types.ObjectId;
    planSlug: string;
    planStartedAt: Date;
  } {
    return {
      planId: plan._id,
      planSlug: plan.slug,
      planStartedAt: new Date(),
    };
  }
}
