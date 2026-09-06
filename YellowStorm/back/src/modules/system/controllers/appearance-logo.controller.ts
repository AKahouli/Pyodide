import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { multipartFileInterceptorOptions } from '@common/utils';
import { Public } from '@modules/auth/decorators/public.decorator';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { RateLimit } from '@modules/rate-limiter';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { APPEARANCE_LOGO_CONSTRAINTS } from '../constants/appearance-logo.constants';
import { SkipMaintenance } from '../decorators/skip-maintenance.decorator';
import type { AppearanceLogo } from '../interfaces/appearance.interface';
import { AppearanceLogoService } from '../services/appearance-logo.service';
import { SystemService } from '../system.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('System Appearance Logos')
@Controller('experimental/system/appearance/logos')
export class AppearanceLogoController {
  constructor(
    private readonly appearanceLogoService: AppearanceLogoService,
    private readonly systemService: SystemService,
  ) {}

  @Get(':id/file')
  @Public()
  @SkipMaintenance()
  @SkipResponseWrap()
  @RateLimit({ limit: 120, windowMs: 60000, keyPrefix: 'appearance-logo:file' })
  @ApiOperation({ summary: 'Download a custom appearance logo' })
  async getFile(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const file = await this.appearanceLogoService.getFile(id);
    const isSvg = file.contentType === 'image/svg+xml';
    response.status(200);
    response.setHeader('Content-Type', isSvg ? 'application/octet-stream' : file.contentType);
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Helmet defaults CORP to same-origin, which blocks <img> from the SPA origin.
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (isSvg) {
      response.setHeader('Content-Disposition', 'attachment');
    }
    response.setHeader('Content-Length', file.data.length);
    response.send(file.data);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } } } })
  @ApiOperation({ summary: 'Upload a custom appearance logo' })
  @UseInterceptors(FileInterceptor('file', multipartFileInterceptorOptions(APPEARANCE_LOGO_CONSTRAINTS.maxSourceBytes)))
  async create(@UploadedFile() file: MulterFile, @Body('name') name?: string): Promise<AppearanceLogo> {
    const created = await this.appearanceLogoService.create(file, name);
    this.systemService.invalidateAppearanceCache();
    return created;
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Rename or replace a custom appearance logo' })
  @UseInterceptors(FileInterceptor('file', multipartFileInterceptorOptions(APPEARANCE_LOGO_CONSTRAINTS.maxSourceBytes)))
  async update(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('name') name?: string,
  ): Promise<AppearanceLogo> {
    const updated = await this.appearanceLogoService.update(id, file, name);
    this.systemService.invalidateAppearanceCache();
    return updated;
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a custom appearance logo' })
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.appearanceLogoService.remove(id);
    this.systemService.invalidateAppearanceCache();
    return { deleted: true };
  }
}
