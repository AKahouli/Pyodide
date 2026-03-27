import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { SystemService } from './system.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipMaintenance } from './decorators/skip-maintenance.decorator';
import { RateLimitSkip } from '../rate-limiter';
import { MaintenanceStatus } from './interfaces/maintenance.interface';
import { RegistrationStatus } from './interfaces/registration.interface';
import { RequirePermissions, PermissionsGuard, Permissions, AuditLogService } from '../authorization';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';

@ApiTags('System (Experimental)')
@Controller('experimental/system')
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('maintenance')
  @Public()
  @SkipMaintenance()
  @RateLimitSkip()
  @ApiOperation({
    summary: 'Get maintenance mode status',
    description: 'Returns current maintenance mode status. This endpoint is always accessible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Maintenance status retrieved',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: false },
        message: { type: 'string', example: 'System is under maintenance.' },
        estimatedEndAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async getMaintenanceStatus(): Promise<MaintenanceStatus> {
    return this.systemService.getMaintenanceStatus();
  }

  @Post('maintenance')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set maintenance mode',
    description: 'Enable or disable maintenance mode. Requires system.maintenance permission.',
  })
  @ApiResponse({
    status: 200,
    description: 'Maintenance mode updated',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        message: { type: 'string', example: 'System is under maintenance.' },
        estimatedEndAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async setMaintenanceMode(
    @Body() body: { enabled: boolean; message?: string; estimatedEndAt?: string },
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<MaintenanceStatus> {
    const result = await this.systemService.setMaintenanceMode(body.enabled, {
      message: body.message,
      estimatedEndAt: body.estimatedEndAt ? new Date(body.estimatedEndAt) : undefined,
      userId: user._id.toString(),
    });

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.maintenance',
      metadata: {
        enabled: body.enabled,
        message: body.message,
        estimatedEndAt: body.estimatedEndAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }

  @Get('registration')
  @Public()
  @SkipMaintenance()
  @RateLimitSkip()
  @ApiOperation({
    summary: 'Get registration status',
    description: 'Returns whether user registration is currently enabled. This endpoint is always accessible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration status retrieved',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        disabledAt: { type: 'string', format: 'date-time', nullable: true },
        disabledBy: { type: 'string', nullable: true },
      },
    },
  })
  async getRegistrationStatus(): Promise<RegistrationStatus> {
    return this.systemService.getRegistrationStatus();
  }

  @Post('registration')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_REGISTRATION)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set registration status',
    description: 'Enable or disable user registration. Requires system.registration permission.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration status updated',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', example: true },
        disabledAt: { type: 'string', format: 'date-time', nullable: true },
        disabledBy: { type: 'string', nullable: true },
      },
    },
  })
  async setRegistrationStatus(
    @Body() body: { enabled: boolean },
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<RegistrationStatus> {
    const result = await this.systemService.setRegistrationEnabled(body.enabled, {
      userId: user._id.toString(),
    });

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.registration',
      metadata: {
        enabled: body.enabled,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
