// Module
export { UsageModule } from './usage.module';

// Service
export { UsageService } from './usage.service';

// Schemas
export { PlanTier } from './schemas/plan.schema';
export { PLAN_STORE, type PlanRecord } from './persistence/plan.store';
export { UsageType } from './usage-type.enum';

// Guards
export { UsageLimitGuard } from './guards/usage-limit.guard';

// Decorators
export { CheckUsage, CheckUsageOptions, CHECK_USAGE_KEY } from './decorators/check-usage.decorator';

// Interfaces
export type {
  PlanResponse,
  PlanSummary,
  CreatePlanData,
  UpdatePlanData,
} from './interfaces/plan.interface';
export { DEFAULT_PLANS } from './interfaces/plan.interface';

export type {
  UsageStatus,
  UsageResponse,
  RecordUsageData,
  UsageHistoryQuery,
  UsageHistoryResponse,
  UsageAnalytics,
  DailyUsage,
  UsageCheckResult,
} from './interfaces/usage.interface';

// DTOs
export { CreatePlanDto } from './dto/create-plan.dto';
export { UpdatePlanDto } from './dto/update-plan.dto';
export { RecordUsageDto } from './dto/record-usage.dto';
export { UsageHistoryQueryDto } from './dto/usage-history-query.dto';
