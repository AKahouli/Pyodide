import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
import { AuthorizationService } from '../authorization.service';
import { AuditLogService } from '../services/audit-log.service';
import { CreateRoleDto, UpdateRoleDto, AssignRoleToUserDto } from '../dto';
import { RoleResponse } from '../interfaces/role.interface';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../constants/permissions';

@ApiTags('Roles (Admin)')
@ApiBearerAuth()
@Controller('admin/roles')
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_ROLES_READ)
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'Roles retrieved' })
  async findAll(): Promise<RoleResponse[]> {
    return this.authorizationService.findAllRoles();
  }

  @Get('active')
  @RequirePermissions(Permissions.ADMIN_ROLES_READ)
  @ApiOperation({ summary: 'Get all active roles' })
  @ApiResponse({ status: 200, description: 'Active roles retrieved' })
  async findActive(): Promise<RoleResponse[]> {
    return this.authorizationService.findActiveRoles();
  }

  @Get(':id')
  @RequirePermissions(Permissions.ADMIN_ROLES_READ)
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role retrieved' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id') id: string): Promise<RoleResponse> {
    return this.authorizationService.findRoleById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.ADMIN_ROLES_MANAGE)
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 400, description: 'Invalid permissions' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<RoleResponse> {
    const role = await this.authorizationService.createRole(dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'admin.roles.create',
      targetId: role.id,
      targetType: 'Role',
      metadata: { roleName: role.name, permissions: role.permissions },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return role;
  }

  @Put(':id')
  @RequirePermissions(Permissions.ADMIN_ROLES_MANAGE)
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 400, description: 'Invalid permissions' })
  @ApiResponse({ status: 403, description: 'Cannot modify system role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<RoleResponse> {
    const role = await this.authorizationService.updateRole(id, dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'admin.roles.update',
      targetId: role.id,
      targetType: 'Role',
      metadata: { roleName: role.name, changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return role;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.ADMIN_ROLES_MANAGE)
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 204, description: 'Role deleted' })
  @ApiResponse({ status: 403, description: 'Cannot delete system role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    // Get role name before deletion for audit log
    const role = await this.authorizationService.findRoleById(id);

    await this.authorizationService.deleteRole(id);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'admin.roles.delete',
      targetId: id,
      targetType: 'Role',
      metadata: { roleName: role.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ==================== User Role Assignment ====================

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.USERS_ASSIGN_ROLE)
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiResponse({ status: 200, description: 'Role assigned' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async assignRole(
    @Body() dto: AssignRoleToUserDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.authorizationService.assignRoleToUser(dto.userId, dto.roleId);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'users.assign_role',
      targetId: dto.userId,
      targetType: 'User',
      metadata: { roleId: dto.roleId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'Role assigned successfully' };
  }

  @Post('unassign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.USERS_ASSIGN_ROLE)
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiResponse({ status: 200, description: 'Role removed' })
  async unassignRole(
    @Body() dto: AssignRoleToUserDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.authorizationService.removeRoleFromUser(dto.userId, dto.roleId);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'users.remove_role',
      targetId: dto.userId,
      targetType: 'User',
      metadata: { roleId: dto.roleId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { message: 'Role removed successfully' };
  }

  @Get('user/:userId')
  @RequirePermissions([Permissions.USERS_READ, Permissions.ADMIN_ROLES_READ], 'any')
  @ApiOperation({ summary: 'Get roles for a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User roles retrieved' })
  async getUserRoles(@Param('userId') userId: string): Promise<RoleResponse[]> {
    return this.authorizationService.getUserRoles(userId);
  }
}
