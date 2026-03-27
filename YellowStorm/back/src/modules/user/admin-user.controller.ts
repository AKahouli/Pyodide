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
import { UsageService } from '../usage/usage.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument, UserStatus } from './schemas/user.schema';
import { Permissions } from '../authorization/constants/permissions';
import {
  AdminListUsersQueryDto,
  AssignPlanDto,
  AdminUserResponse,
  AdminUserListResponse,
} from './dto/admin-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';

@ApiTags('Admin Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(PermissionsGuard)
export class AdminUserController {
  constructor(
    private readonly userService: UserService,
    private readonly usageService: UsageService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditLogService: AuditLogService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
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

    // Build filter
    const filter: Record<string, unknown> = {};

    if (search) {
      const escapedSearch = escapeRegex(search);
      filter.$or = [
        { email: { $regex: escapedSearch, $options: 'i' } },
        { 'profile.firstName': { $regex: escapedSearch, $options: 'i' } },
        { 'profile.lastName': { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (emailVerified !== undefined) {
      filter.emailVerified = emailVerified;
    }

    if (profileComplete !== undefined) {
      filter.profileComplete = profileComplete;
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute query
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('roles', 'name')
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

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
    const user = await this.userModel
      .findById(id)
      .populate('roles', 'name')
      .lean();

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
    @CurrentUser() actor: UserDocument,
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
    @CurrentUser() actor: UserDocument,
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
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<AdminUserResponse> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const plan = await this.usageService.getPlanById(dto.planId);

    const updatedUser = await this.userService.assignPlan(
      id,
      plan._id,
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
    const populatedUser = await this.userModel
      .findById(updatedUser._id)
      .populate('roles', 'name')
      .lean();

    return this.mapToAdminUserResponse(populatedUser!);
  }

  private mapToAdminUserResponse(user: Record<string, unknown>): AdminUserResponse {
    const profile = user.profile as { firstName?: string; lastName?: string; company?: string } || {};
    const roles = (user.roles || []) as Array<{ _id: { toString(): string }; name: string }>;

    return {
      id: (user._id as { toString(): string }).toString(),
      email: user.email as string,
      emailVerified: user.emailVerified as boolean,
      profileComplete: user.profileComplete as boolean,
      profile: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        company: profile.company,
      },
      status: user.status as UserStatus,
      plan: user.planId
        ? {
            id: (user.planId as { toString(): string }).toString(),
            slug: user.planSlug as string,
            startedAt: user.planStartedAt as Date | undefined,
          }
        : undefined,
      roles: roles.map((role) => ({
        id: role._id.toString(),
        name: role.name,
      })),
      createdAt: user.createdAt as Date,
      updatedAt: user.updatedAt as Date,
      lastLoginAt: user.lastLoginAt as Date | undefined,
    };
  }
}
