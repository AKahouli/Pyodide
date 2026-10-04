import type { AuthUser } from '@common/auth/auth-user';
import { RegistrationApproval, UserStatus } from './user.types';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
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
import { UserService } from './user.service';
import { RegistrationApprovalService } from './registration-approval.service';
import { UsageService } from '../usage/usage.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { USER_STORE, UserRecordWithRoles, UserStore } from './persistence/user.store';
import { Permissions } from '../authorization/constants/permissions';
import {
  AdminListUsersQueryDto,
  AssignPlanDto,
  AdminUserResponse,
  AdminUserListResponse,
} from './dto/admin-user.dto';
import { Inject } from '@nestjs/common';
import { NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@ApiTags('Admin Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(PermissionsGuard)
export class AdminUserController {
  constructor(
    private readonly userService: UserService,
    private readonly registrationApprovalService: RegistrationApprovalService,
    private readonly usageService: UsageService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditLogService: AuditLogService,
    @Inject(USER_STORE) private readonly userStore: UserStore,
  ) {}

  @Get()
  @RequirePermissions(Permissions.USERS_READ)
  @ApiOperation({ summary: 'List all users with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Users retrieved' })
  async listUsers(
    @Query() query: AdminListUsersQueryDto,
  ): Promise<AdminUserListResponse> {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      emailVerified,
      profileComplete,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Execute query (roles joined by the store; filters/sort/pagination preserved)
    const { users, total } = await this.userStore.listAdmin({
      search,
      status,
      emailVerified,
      profileComplete,
      page,
      limit,
      sortBy: sortBy as 'createdAt' | 'email' | 'status',
      sortOrder,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      users: users.map((user) => this.mapToAdminUserResponse(user)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  @Get(':id')
  @RequirePermissions(Permissions.USERS_READ)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User retrieved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(@Param('id') id: string): Promise<AdminUserResponse> {
    const user = await this.userStore.findByIdWithRoles(id);

    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    return this.mapToAdminUserResponse(user);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.USERS_SUSPEND)
  @ApiOperation({ summary: 'Suspend a user account' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User suspended' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async suspendUser(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    await this.userService.suspendUser(id);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.suspend',
      targetId: id,
      targetType: 'User',
      metadata: { targetEmail: user.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'User suspended successfully' };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.USERS_ACTIVATE)
  @ApiOperation({ summary: 'Activate a user account' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User activated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async activateUser(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    await this.userService.activateUser(id);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.activate',
      targetId: id,
      targetType: 'User',
      metadata: { targetEmail: user.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'User activated successfully' };
  }

  @Post(':id/approve-registration')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a pending classic registration (Super Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Registration approved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async approveRegistration(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const result = await this.registrationApprovalService.approveRegistration(id);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.approve_registration',
      targetId: id,
      targetType: 'User',
      metadata: { targetEmail: result.email, changed: result.changed },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'Registration approved' };
  }

  @Post(':id/reject-registration')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reject a pending classic registration (Super Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Registration rejected' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async rejectRegistration(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const result = await this.registrationApprovalService.rejectRegistration(id);

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.reject_registration',
      targetId: id,
      targetType: 'User',
      metadata: { targetEmail: result.email, changed: result.changed },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'Registration rejected' };
  }

  @Post(':id/assign-plan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.USERS_ASSIGN_PLAN)
  @ApiOperation({ summary: 'Assign a plan to a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Plan assigned' })
  @ApiResponse({ status: 404, description: 'User or plan not found' })
  async assignPlan(
    @Param('id') id: string,
    @Body() dto: AssignPlanDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<AdminUserResponse> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const plan = await this.usageService.getPlanById(dto.planId);

    const updatedUser = await this.userService.assignPlan(
      id,
      plan.id,
      plan.slug,
    );

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'users.assign_plan',
      targetId: id,
      targetType: 'User',
      metadata: { targetEmail: user.email, planId: dto.planId, planSlug: plan.slug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Re-fetch with roles populated
    const populatedUser = await this.userStore.findByIdWithRoles(id);

    return this.mapToAdminUserResponse(populatedUser!);
  }

  private mapToAdminUserResponse(user: UserRecordWithRoles): AdminUserResponse {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      profileComplete: user.profileComplete,
      appearance: {
        colorTheme: user.colorTheme ?? 'default',
      },
      profile: {
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
        company: user.company ?? undefined,
      },
      status: user.status as UserStatus,
      registrationApproval: (user.registrationApproval ?? undefined) as RegistrationApproval | undefined,
      plan: user.planId
        ? {
            id: user.planId,
            slug: user.planSlug!,
            startedAt: (user.planStartedAt ?? undefined),
          }
        : undefined,
      roles: user.roles.map((role) => ({
        id: role.id,
        name: role.name,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: (user.lastLoginAt ?? undefined),
    };
  }
}
