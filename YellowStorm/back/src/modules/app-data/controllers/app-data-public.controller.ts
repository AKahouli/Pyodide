import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import type { Request } from 'express';
import { AppDataCatalogService } from '../services/app-data-catalog.service';
import { AppDataPolicyService } from '../services/app-data-policy.service';
import { AppDataQueryService } from '../services/app-data-query.service';
import { AppDataRowService } from '../services/app-data-row.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { normalizeAppDataRowBody } from '../utils/app-data-row-body.util';

@Public()
@SkipResponseWrap()
@ApiTags('App Data Public API')
@Controller('app-data/public/:appDataId/:environment')
export class AppDataPublicController {
  private readonly logger = new Logger(AppDataPublicController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly policies: AppDataPolicyService,
    private readonly query: AppDataQueryService,
    private readonly rows: AppDataRowService,
  ) {}

  private assertEnabled(): void {
    if (
      !this.config.get<boolean>('appData.enabled', false) ||
      !this.config.get<boolean>('appData.publicApiEnabled', false)
    ) {
      throw new ServiceUnavailableException('App Data public API is disabled');
    }
  }

  private resolvePrincipal(req: Request, ownerUserId: string) {
    return this.policies.resolvePrincipal({
      anonymous: !req.headers.authorization,
      ownerUserId,
      requestUserId: null,
    });
  }

  private safeNormalizeBody(req: Request, action: string): Record<string, unknown> {
    const ct = req.headers['content-type'] ?? 'missing';
    try {
      const result = normalizeAppDataRowBody(req.body, req.headers['content-type']);
      if (Object.keys(result).length === 0) {
        const snapshot = JSON.stringify(req.body)?.slice(0, 500) ?? String(req.body);
        this.logger.warn(
          `App Data ${action}: normalized body is empty. ` +
            `Content-Type: ${ct}, typeof req.body: ${typeof req.body}, ` +
            `keys: [${req.body && typeof req.body === 'object' ? Object.keys(req.body).join(', ') : ''}], ` +
            `snapshot: ${snapshot}`,
        );
      }
      return result;
    } catch (err) {
      this.logger.warn(
        `App Data ${action}: body normalization failed (Content-Type: ${ct}) — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      throw new AppDataException(
        AppDataErrorCode.INVALID_MANIFEST,
        err instanceof Error ? err.message : 'Invalid request body',
      );
    }
  }

  @Get('tables/:table/rows')
  @ApiOperation({ summary: 'List rows with equality filters' })
  async list(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const principal = this.resolvePrincipal(req, app.ownerUserId);
    const { page, pageSize, orderBy, orderDir, ...filters } = query;
    return this.query.listRows({
      appDataId,
      environment,
      table,
      filters,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : undefined,
      orderBy,
      orderDir: orderDir === 'desc' ? 'desc' : 'asc',
      principal,
      ownerUserId: app.ownerUserId,
    });
  }

  @Get('tables/:table/rows/:id')
  async getOne(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const principal = this.resolvePrincipal(req, app.ownerUserId);
    return this.query.getRow({
      appDataId,
      environment,
      table,
      id,
      principal,
      ownerUserId: app.ownerUserId,
    });
  }

  @Post('tables/:table/rows')
  async insert(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const principal = this.resolvePrincipal(req, app.ownerUserId);
    const row = this.safeNormalizeBody(req, 'insert');
    return {
      row: await this.rows.insertRow({
        appDataId,
        environment,
        table,
        row,
        principal,
        ownerUserId: app.ownerUserId,
      }),
    };
  }

  @Patch('tables/:table/rows/:id')
  async update(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const principal = this.resolvePrincipal(req, app.ownerUserId);
    const patch = this.safeNormalizeBody(req, 'update');
    return {
      row: await this.rows.updateRow({
        appDataId,
        environment,
        table,
        id,
        patch,
        principal,
        ownerUserId: app.ownerUserId,
      }),
    };
  }

  @Delete('tables/:table/rows/:id')
  async remove(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const principal = this.resolvePrincipal(req, app.ownerUserId);
    return {
      row: await this.rows.deleteRow({
        appDataId,
        environment,
        table,
        id,
        principal,
        ownerUserId: app.ownerUserId,
      }),
    };
  }
}
