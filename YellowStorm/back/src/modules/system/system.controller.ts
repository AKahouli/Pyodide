import { Controller, Get, Post, Put, Delete, Body, Req, HttpCode, HttpStatus, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SystemService, EMAIL_LOGO_MAX_BYTES } from './system.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipMaintenance } from './decorators/skip-maintenance.decorator';
import { RateLimitSkip } from '../rate-limiter';
import { BadRequestException } from '../exceptions';
import { MaintenanceStatus } from './interfaces/maintenance.interface';
import { RegistrationStatus } from './interfaces/registration.interface';
import { AppearanceSettings } from './interfaces/appearance.interface';
import { SetAppearanceSettingsDto } from './dto/set-appearance-settings.dto';
import { CorsSettingsValue } from './schemas/system-setting.schema';
import { decodeMultipartFilename, multipartFileInterceptorOptions } from '../../common/utils';
import { RequirePermissions, PermissionsGuard, Permissions, AuditLogService } from '../authorization';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { FeatureVisibilityService } from './feature-visibility.service';
import type { FeatureVisibility } from './interfaces/feature-visibility.interface';
import { UpdateFeatureVisibilityDto } from './dto/update-feature-visibility.dto';
import { UpdateDocumentTreeInjectionDto } from './dto/update-document-tree-injection.dto';
import type { DocumentTreeInjectionSettings } from './interfaces/document-tree-settings.interface';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface EmailLogoResponse {
  filename: string;
  contentType: string;
  size: number;
  updatedAt: string;
  dataUri: string;
}

function toEmailLogoResponse(value: {
  filename: string;
  contentType: string;
  size: number;
  updatedAt: Date;
  data: string;
}): EmailLogoResponse {
  return {
    filename: value.filename,
    contentType: value.contentType,
    size: value.size,
    updatedAt: value.updatedAt.toISOString(),
    dataUri: `data:${value.contentType};base64,${value.data}`,
  };
}

@ApiTags('System (Experimental)')
@Controller('experimental/system')
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly auditLogService: AuditLogService,
    private readonly featureVisibilityService: FeatureVisibilityService,
  ) {}

  @Get('features')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get main sidebar feature visibility' })
  getFeatureVisibility(): Promise<FeatureVisibility> {
    return this.featureVisibilityService.getVisibility();
  }

  @Put('features')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update main sidebar feature visibility' })
  async updateFeatureVisibility(
    @Body() body: UpdateFeatureVisibilityDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<FeatureVisibility> {
    const result = await this.featureVisibilityService.updateVisibility(body);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.features',
      metadata: { ...body },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }

  @Get('document-tree-injection')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get global document-tree prompt injection setting' })
  getDocumentTreeInjectionSettings(): Promise<DocumentTreeInjectionSettings> {
    return this.systemService.getDocumentTreeInjectionSettings();
  }

  @Put('document-tree-injection')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable global document-tree prompt injection' })
  async updateDocumentTreeInjectionSettings(
    @Body() body: UpdateDocumentTreeInjectionDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<DocumentTreeInjectionSettings> {
    const result = await this.systemService.setDocumentTreeInjectionSettings(body.enabled);
    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.documentTreeInjection',
      metadata: { enabled: result.enabled },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

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

  @Get('appearance')
  @Public()
  @SkipMaintenance()
  @RateLimitSkip()
  @ApiOperation({ summary: 'Get appearance settings' })
  async getAppearanceSettings(): Promise<AppearanceSettings> {
    return this.systemService.getAppearanceSettings();
  }

  @Post('appearance')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set appearance settings' })
  async setAppearanceSettings(
    @Body() body: SetAppearanceSettingsDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<AppearanceSettings> {
    const result = await this.systemService.setAppearanceSettings(body);
    const applyToAllUsers = body.applyToAllUsers === true;
    if (applyToAllUsers) {
      await this.systemService.applyAppearanceToAllUsers(body.defaultColorTheme);
    }

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.appearance',
      metadata: {
        defaultColorTheme: body.defaultColorTheme,
        themes: body.themes,
        applyToAllUsers,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }

  @Get('email-logo')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the admin-configured email logo (null when default is used)' })
  async getEmailLogo(): Promise<{ logo: EmailLogoResponse | null }> {
    const logo = await this.systemService.getEmailLogo();
    if (!logo) {
      return { logo: null };
    }
    return { logo: toEmailLogoResponse(logo) };
  }

  @Post('email-logo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @UseInterceptors(FileInterceptor('file', multipartFileInterceptorOptions(EMAIL_LOGO_MAX_BYTES)))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload the email logo used in all transactional email templates (PNG/JPEG, max 512 KB)' })
  async setEmailLogo(
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<{ logo: EmailLogoResponse }> {
    if (!file) {
      throw new BadRequestException('Email logo file is required');
    }

    file.originalname = decodeMultipartFilename(file.originalname);

    let logo;
    try {
      logo = await this.systemService.setEmailLogo(
        {
          buffer: file.buffer,
          contentType: file.mimetype,
          filename: file.originalname,
          size: file.size,
        },
        user._id.toString(),
      );
    } catch (error) {
      throw new BadRequestException(
        (error as Error).message || 'Invalid email logo file',
      );
    }

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.emailLogo',
      metadata: {
        contentType: logo.contentType,
        size: logo.size,
        filename: logo.filename,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { logo: toEmailLogoResponse(logo) };
  }

  @Delete('email-logo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove the custom email logo and fall back to the bundled default' })
  async clearEmailLogo(
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<{ logo: null }> {
    await this.systemService.clearEmailLogo(user._id.toString());

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.emailLogo.remove',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { logo: null };
  }

  @Get('cors')
  @Public()
  @SkipMaintenance()
  @RateLimitSkip()
  @ApiOperation({ summary: 'Get CORS settings' })
  async getCorsSettings(): Promise<CorsSettingsValue & { updatedAt?: string; updatedBy?: string }> {
    const settings = await this.systemService.getCorsSettings();
    return settings;
  }

  @Post('cors')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('system.cors')
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set CORS settings', description: 'Requires system.cors permission.' })
  async setCorsSettings(
    @Body() body: { origins: Array<{ origin: string; enabled: boolean }> },
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<CorsSettingsValue> {
    const result = await this.systemService.setCorsSettings(body.origins, user._id.toString());

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'system.cors',
      metadata: { origins: body.origins },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
