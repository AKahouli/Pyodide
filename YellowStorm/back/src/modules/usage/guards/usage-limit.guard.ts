import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UsageService } from '../usage.service';
import { CHECK_USAGE_KEY, CheckUsageOptions } from '../decorators/check-usage.decorator';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type { AuthUser } from '@common/auth/auth-user';
import type { PlanRecord } from '../persistence/plan.store';

// Extend Express Request to include user
interface RequestWithUser extends Request {
  user?: AuthUser;
  userPlan?: PlanRecord;
}

/**
 * Guard that checks if user has exceeded their usage limits
 * Apply to endpoints that consume tokens/resources
 */
@Injectable()
export class UsageLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => UsageService))
    private readonly usageService: UsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get decorator options
    const options = this.reflector.getAllAndOverride<CheckUsageOptions>(
      CHECK_USAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no decorator or skip is true, allow
    if (!options || options.skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser & {
      aiProxyAuth?: { mode?: string };
    }>();
    const user = request.user;

    // App Builder AI Proxy uses a dedicated quota (AppBuilderAiUsageLimitGuard).
    const mode = request.aiProxyAuth?.mode;
    if (mode === 'ai_preview' || mode === 'app_end_user') {
      return true;
    }

    // If no user, let auth guard handle it
    if (!user) {
      return true;
    }

    // Get user's plan
    const plan = await this.usageService.ensureUserHasPlan(
      user._id.toString(),
      user.planId,
    );

    // Attach plan to request for use in controllers
    request.userPlan = plan;

    // Check required feature if specified
    if (options.requiredFeature) {
      if (!plan.features.includes(options.requiredFeature)) {
        throw new ForbiddenException(
          ErrorCode.PLAN_FEATURE_NOT_AVAILABLE,
          `This feature requires the "${options.requiredFeature}" feature. Please upgrade your plan.`,
        );
      }
    }

    // Check token limits if enabled
    if (options.checkTokens !== false) {
      const usageCheck = await this.usageService.checkUsageLimit(
        user._id.toString(),
        plan,
        options.estimatedTokens,
      );

      if (!usageCheck.allowed) {
        const resetTime = usageCheck.resetsAt.toISOString();
        throw new ForbiddenException(
          ErrorCode.USAGE_LIMIT_EXCEEDED,
          `You have exceeded your token limit. Your limit will reset at ${resetTime}. ` +
            `Current usage: ${usageCheck.currentUsage}/${usageCheck.limit} tokens.`,
        );
      }
    }

    return true;
  }
}
