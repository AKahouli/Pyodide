import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { AuthProviderService } from '../services/auth-provider.service';
import { CreateAuthProviderDto } from '../dto/create-auth-provider.dto';
import { UpdateAuthProviderDto } from '../dto/update-auth-provider.dto';
import { UpdateClassicAuthDto } from '../dto/update-classic-auth.dto';

@ApiTags('Admin - Auth Providers')
@ApiBearerAuth()
@Controller('admin/auth-providers')
export class AuthProviderAdminController {
  constructor(
    private readonly authProviderService: AuthProviderService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions([Permissions.AUTH_PROVIDERS_READ, Permissions.AUTH_PROVIDERS_ALL], 'any')
  @ApiOperation({ summary: 'List all auth providers (admin)' })
  @ApiResponse({ status: 200, description: 'All providers with masked secrets' })
  async findAll() {
    return this.authProviderService.findAll();
  }

  @Get('classic')
  @RequirePermissions(
    [Permissions.AUTH_PROVIDERS_READ, Permissions.AUTH_PROVIDERS_ALL, Permissions.SYSTEM_REGISTRATION],
    'any',
  )
  @ApiOperation({ summary: 'Get classic auth settings' })
  @ApiResponse({ status: 200, description: 'Classic auth details' })
  async getClassicAuth() {
    return this.authProviderService.getClassicAuthAdmin();
  }

  @Patch('classic')
  @RequirePermissions(
    [Permissions.AUTH_PROVIDERS_UPDATE, Permissions.AUTH_PROVIDERS_ALL, Permissions.SYSTEM_REGISTRATION],
    'any',
  )
  @ApiOperation({ summary: 'Update classic auth settings' })
  @ApiResponse({ status: 200, description: 'Classic auth updated' })
  async updateClassicAuth(
    @Body() dto: UpdateClassicAuthDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    const result = await this.authProviderService.updateClassicAuth(
      dto,
      user._id.toString(),
    );

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'auth_providers.update',
      targetId: 'classic',
      targetType: 'auth_provider',
      metadata: { providerKey: 'classic', ...dto },
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return result;
  }

  @Get(':id')
  @RequirePermissions([Permissions.AUTH_PROVIDERS_READ, Permissions.AUTH_PROVIDERS_ALL], 'any')
  @ApiOperation({ summary: 'Get auth provider by ID (admin)' })
  @ApiResponse({ status: 200, description: 'Provider details' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async findById(@Param('id') id: string) {
    return this.authProviderService.findById(id);
  }

  @Post()
  @RequirePermissions([Permissions.AUTH_PROVIDERS_CREATE, Permissions.AUTH_PROVIDERS_ALL], 'any')
  @ApiOperation({ summary: 'Create auth provider' })
  @ApiResponse({ status: 201, description: 'Provider created' })
  @ApiResponse({ status: 409, description: 'Provider key already exists' })
  async create(
    @Body() dto: CreateAuthProviderDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    const result = await this.authProviderService.create(dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'auth_providers.create',
      targetId: result.id,
      targetType: 'auth_provider',
      metadata: { providerKey: dto.providerKey },
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return result;
  }

  @Patch(':id')
  @RequirePermissions([Permissions.AUTH_PROVIDERS_UPDATE, Permissions.AUTH_PROVIDERS_ALL], 'any')
  @ApiOperation({ summary: 'Update auth provider' })
  @ApiResponse({ status: 200, description: 'Provider updated' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAuthProviderDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    const result = await this.authProviderService.update(id, dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'auth_providers.update',
      targetId: id,
      targetType: 'auth_provider',
      metadata: { providerKey: result.providerKey },
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return result;
  }

  @Delete(':id')
  @RequirePermissions([Permissions.AUTH_PROVIDERS_DELETE, Permissions.AUTH_PROVIDERS_ALL], 'any')
  @ApiOperation({ summary: 'Delete auth provider' })
  @ApiResponse({ status: 200, description: 'Provider deleted' })
  @ApiResponse({ status: 400, description: 'Provider in use' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async delete(
    @Param('id') id: string,
    @Query('deleteLinks') deleteLinks: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    // Get provider info before deletion for audit log
    const provider = await this.authProviderService.findById(id);

    const result = await this.authProviderService.delete(id, deleteLinks === 'true');

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'auth_providers.delete',
      targetId: id,
      targetType: 'auth_provider',
      metadata: {
        providerKey: provider.providerKey,
        deleteLinks: deleteLinks === 'true',
        unlinkedUsers: result.unlinkedUsers,
      },
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return { message: 'Provider deleted successfully', unlinkedUsers: result.unlinkedUsers };
  }
}
