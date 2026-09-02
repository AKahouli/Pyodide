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
import { APPEARANCE_LOGO_CONSTRAINTS } from '../constants/appearance-logo.constants';
import { Public } from '../../auth/decorators/public.decorator';
import { Permissions, PermissionsGuard, RequirePermissions } from '../../authorization';
import { SkipMaintenance } from '../decorators/skip-maintenance.decorator';
import { SkipResponseWrap } from '../../response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '../../rate-limiter';
import type { AppearanceLogo } from '../interfaces/appearance.interface';
import { AppearanceLogoService } from '../services/appearance-logo.service';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('System Appearance Logos')
@Controller('experimental/system/appearance/logos')
export class AppearanceLogoController {
  constructor(private readonly appearanceLogoService: AppearanceLogoService) {}

  @Get(':id/file')
  @Public()
  @SkipMaintenance()
  @SkipResponseWrap()
  @RateLimit({ limit: 120, windowMs: 60000, keyPrefix: 'appearance-logo:file' })
  @ApiOperation({ summary: 'Download a custom appearance logo' })
  async getFile(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const file = await this.appearanceLogoService.getFile(id);
    response.status(200);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Helmet defaults CORP to same-origin, which blocks <img> from the SPA origin.
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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
  create(@UploadedFile() file: MulterFile, @Body('name') name?: string): Promise<AppearanceLogo> {
    return this.appearanceLogoService.create(file, name);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Rename or replace a custom appearance logo' })
  @UseInterceptors(FileInterceptor('file', multipartFileInterceptorOptions(APPEARANCE_LOGO_CONSTRAINTS.maxSourceBytes)))
  update(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('name') name?: string,
  ): Promise<AppearanceLogo> {
    return this.appearanceLogoService.update(id, file, name);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
  @SkipMaintenance()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a custom appearance logo' })
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.appearanceLogoService.remove(id);
    return { deleted: true };
  }
}
