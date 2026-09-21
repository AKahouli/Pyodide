import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsageService } from './usage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UsageHistoryQueryDto } from './dto/usage-history-query.dto';
import { PlanResponse } from './interfaces/plan.interface';
import { UsageStatus, UsageHistoryResponse } from './interfaces/usage.interface';
import { Public } from '../auth';
import { RequirePermissions, PermissionsGuard, Permissions, AuditLogService } from '../authorization';

@ApiTags('Usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==================== User Endpoints ====================

  @Get('status')
  @ApiOperation({ summary: 'Get current usage status' })
  @ApiResponse({ status: 200, description: 'Usage status retrieved' })
  async getUsageStatus(@CurrentUser() user: AuthUser): Promise<UsageStatus> {
    const plan = await this.usageService.ensureUserHasPlan(
      user._id.toString(),
      user.planId,
    );
    return this.usageService.getUsageStatus(user._id.toString(), plan);
  }

  @Get('plan')
  @ApiOperation({ summary: 'Get current user plan' })
  @ApiResponse({ status: 200, description: 'Plan retrieved' })
  async getCurrentPlan(@CurrentUser() user: AuthUser): Promise<PlanResponse> {
    const plan = await this.usageService.ensureUserHasPlan(
      user._id.toString(),
      user.planId,
    );
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? undefined,
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

  @Get('history')
  @ApiOperation({ summary: 'Get usage history' })
  @ApiResponse({ status: 200, description: 'Usage history retrieved' })
  async getUsageHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: UsageHistoryQueryDto,
  ): Promise<UsageHistoryResponse> {
    return this.usageService.getUsageHistory(user._id.toString(), {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit,
      skip: query.skip,
    });
  }

  // ==================== Plan Management (Admin) ====================
  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Get all available plans' })
  @ApiResponse({ status: 200, description: 'Plans retrieved' })
  async getPlans(): Promise<PlanResponse[]> {
    return this.usageService.getActivePlans();
  }

  @Get('plans/all')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.PLANS_READ_ALL)
  @ApiOperation({ summary: 'Get all plans including inactive (admin)' })
  @ApiResponse({ status: 200, description: 'All plans retrieved' })
  async getAllPlans(): Promise<PlanResponse[]> {
    return this.usageService.getAllPlans();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get plan by ID' })
  @ApiParam({ name: 'id', description: 'Plan ID' })
  @ApiResponse({ status: 200, description: 'Plan retrieved' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async getPlanById(@Param('id') id: string): Promise<PlanResponse> {
    const plan = await this.usageService.getPlanById(id);
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? undefined,
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

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.PLANS_CREATE)
  @ApiOperation({ summary: 'Create a new plan (admin)' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @ApiResponse({ status: 409, description: 'Plan slug already exists' })
  async createPlan(
    @Body() dto: CreatePlanDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const plan = await this.usageService.createPlan(dto);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'plans.create',
      targetId: plan.id,
      targetType: 'Plan',
      metadata: { planName: plan.name, planSlug: plan.slug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? undefined,
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

  @Put('plans/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.PLANS_UPDATE)
  @ApiOperation({ summary: 'Update a plan (admin)' })
  @ApiParam({ name: 'id', description: 'Plan ID' })
  @ApiResponse({ status: 200, description: 'Plan updated' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const plan = await this.usageService.updatePlan(id, dto);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'plans.update',
      targetId: plan.id,
      targetType: 'Plan',
      metadata: { planName: plan.name, planSlug: plan.slug, updatedFields: Object.keys(dto) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? undefined,
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

  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.PLANS_DELETE)
  @ApiOperation({ summary: 'Delete a plan (admin)' })
  @ApiParam({ name: 'id', description: 'Plan ID' })
  @ApiResponse({ status: 204, description: 'Plan deleted' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete default plan' })
  async deletePlan(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    // Get plan info before deletion for audit log
    const plan = await this.usageService.getPlanById(id);

    await this.usageService.deletePlan(id);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'plans.delete',
      targetId: id,
      targetType: 'Plan',
      metadata: { planName: plan.name, planSlug: plan.slug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
