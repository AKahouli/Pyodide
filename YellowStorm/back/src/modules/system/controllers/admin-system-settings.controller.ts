import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequirePermissions, Permissions, PermissionsGuard, AuditLogService } from '../../authorization';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { SYSTEM_SETTING_STORE, type SystemSettingStore, type SystemSettingRow } from '../persistence/system-setting.store';
import { Inject } from '@nestjs/common';

/**
 * Keys an import may write. Anything outside this list is rejected so a
 * malformed import cannot plant arbitrary settings. Value shapes are not
 * validated here — each owning settings service normalizes (or reverts to
 * defaults) when it reads a malformed value.
 */
const IMPORTABLE_KEYS: ReadonlySet<string> = new Set([
  'maintenance_mode',
  'registration_settings',
  'appearance_settings',
  'playbook_settings',
  'cors_settings',
  'document_tree_injection_settings',
  'login_settings',
  'email_logo',
  'workspace_uploads',
  'conversation_settings',
  'navigation_settings',
  'workspace_evidence_search',
  'workspace_transformations',
  'platform_settings',
  'feature_visibility',
  'app_builder_ai_settings',
]);

const MAX_IMPORT_ROWS = 100;

@ApiTags('System Settings')
@ApiBearerAuth()
@Controller('admin/system-settings')
@UseGuards(PermissionsGuard)
export class AdminSystemSettingsController {
  constructor(
    @Inject(SYSTEM_SETTING_STORE)
    private readonly systemSettings: SystemSettingStore,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('export')
  @SkipResponseWrap()
  @ApiOperation({
    summary: 'Export all admin-configured settings',
    description:
      'Returns every catalog.system_settings row as JSON. Use the payload with POST /admin/system-settings/import ' +
      'to initialize a fresh environment with the same configuration.',
  })
  @ApiResponse({ status: 200, description: 'Settings exported' })
  @RequirePermissions(Permissions.SYSTEM_ALL)
  async exportSettings(@Res() res: Response): Promise<void> {
    const rows: SystemSettingRow[] = await this.systemSettings.listAll();
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: rows.map(({ key, value }) => ({ key, value })),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="yellowstorm-settings-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  }

  @Post('import')
  @ApiOperation({
    summary: 'Import admin-configured settings',
    description:
      'Upserts settings rows from an export payload. Unknown keys are rejected; malformed values fall back to ' +
      'defaults when read. Intended to initialize a fresh environment.',
  })
  @ApiResponse({ status: 200, description: 'Settings imported' })
  @RequirePermissions(Permissions.SYSTEM_ALL)
  async importSettings(
    @Body() body: { settings?: Array<{ key?: unknown; value?: unknown }> },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ imported: string[]; skipped: Array<{ key: string; reason: string }> }> {
    const rows = body?.settings;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Import payload must contain a non-empty "settings" array');
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, `Import payload exceeds ${MAX_IMPORT_ROWS} rows`);
    }

    const imported: string[] = [];
    const skipped: Array<{ key: string; reason: string }> = [];
    for (const row of rows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      if (!IMPORTABLE_KEYS.has(key)) {
        skipped.push({ key: key || '<missing>', reason: 'unknown_key' });
        continue;
      }
      if (typeof row.value !== 'object' || row.value === null) {
        skipped.push({ key, reason: 'invalid_value' });
        continue;
      }
      await this.systemSettings.upsert(key, row.value);
      imported.push(key);
    }

    if (imported.length > 0) {
      this.auditLogService.logSuccess({
        actorId: user._id.toString(),
        actorEmail: user.email,
        action: 'system.settings.import',
        metadata: { imported, skippedCount: skipped.length },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return { imported, skipped };
  }
}
