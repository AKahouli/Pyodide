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
import { RateLimit } from '@modules/rate-limiter';
import type { Request } from 'express';
import { AppDataCatalogService } from '../services/app-data-catalog.service';
import { AppDataQueryService } from '../services/app-data-query.service';
import { AppDataRowService } from '../services/app-data-row.service';
import { AppDataPublicAccessService } from '../services/app-data-public-access.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { normalizeAppDataRowBody } from '../utils/app-data-row-body.util';
import { parseAppDataEnvironment, parsePositiveInt } from '../utils/app-data-request.util';

const PUBLIC_CRUD_READ_LIMIT = Number.parseInt(
  process.env.APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE || '600',
  10,
);
const PUBLIC_CRUD_WRITE_LIMIT = 120;

function publicCrudLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PUBLIC_CRUD_READ_RATE_LIMIT = {
  limit: publicCrudLimit(PUBLIC_CRUD_READ_LIMIT, 600),
  windowMs: 60_000,
  keyPrefix: 'app-data:public:crud',
} as const;

const PUBLIC_CRUD_WRITE_RATE_LIMIT = {
  limit: PUBLIC_CRUD_WRITE_LIMIT,
  windowMs: 60_000,
  keyPrefix: 'app-data:public:crud',
} as const;

@Public()
@SkipResponseWrap()
@ApiTags('App Data Public API')
@Controller('app-data/public/:appDataId/:environment')
@RateLimit(PUBLIC_CRUD_READ_RATE_LIMIT)
export class AppDataPublicController {
  private readonly logger = new Logger(AppDataPublicController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly access: AppDataPublicAccessService,
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

  private safeNormalizeBody(req: Request, action: string): Record<string, unknown> {
    const ct = req.headers['content-type'] ?? 'missing';
    try {
      const result = normalizeAppDataRowBody(req.body, req.headers['content-type']);
      if (Object.keys(result).length === 0) {
        this.logger.warn(
          `App Data ${action}: normalized body is empty. ` +
            `Content-Type: ${ct}, typeof req.body: ${typeof req.body}, ` +
            `keys: [${req.body && typeof req.body === 'object' ? Object.keys(req.body).join(', ') : ''}]`,
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
    const env = parseAppDataEnvironment(environment);
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const access = await this.access.authorizeCrud({
      app,
      environment: env,
      operation: 'select',
      req,
    });
    const { page, pageSize, orderBy, orderDir, ...filters } = query;
    return this.query.listRows({
      appDataId,
      environment: env,
      table,
      filters,
      page: parsePositiveInt(page, 1),
      pageSize: pageSize ? parsePositiveInt(pageSize, 50) : undefined,
      orderBy,
      orderDir: orderDir === 'desc' ? 'desc' : 'asc',
      principal: access.principal,
      ownerUserId: app.ownerUserId,
      skipPolicyCheck: access.skipPolicyCheck,
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
    const env = parseAppDataEnvironment(environment);
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const access = await this.access.authorizeCrud({
      app,
      environment: env,
      operation: 'select',
      req,
    });
    return this.query.getRow({
      appDataId,
      environment: env,
      table,
      id,
      principal: access.principal,
      ownerUserId: app.ownerUserId,
      skipPolicyCheck: access.skipPolicyCheck,
    });
  }

  @Post('tables/:table/rows')
  @RateLimit(PUBLIC_CRUD_WRITE_RATE_LIMIT)
  async insert(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const access = await this.access.authorizeCrud({
      app,
      environment: env,
      operation: 'insert',
      req,
    });
    const row = this.safeNormalizeBody(req, 'insert');
    return {
      row: await this.rows.insertRow({
        appDataId,
        environment: env,
        table,
        row,
        principal: access.principal,
        ownerUserId: app.ownerUserId,
        skipPolicyCheck: access.skipPolicyCheck,
      }),
    };
  }

  @Patch('tables/:table/rows/:id')
  @RateLimit(PUBLIC_CRUD_WRITE_RATE_LIMIT)
  async update(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const access = await this.access.authorizeCrud({
      app,
      environment: env,
      operation: 'update',
      req,
    });
    const patch = this.safeNormalizeBody(req, 'update');
    return {
      row: await this.rows.updateRow({
        appDataId,
        environment: env,
        table,
        id,
        patch,
        principal: access.principal,
        ownerUserId: app.ownerUserId,
        skipPolicyCheck: access.skipPolicyCheck,
      }),
    };
  }

  @Delete('tables/:table/rows/:id')
  @RateLimit(PUBLIC_CRUD_WRITE_RATE_LIMIT)
  async remove(
    @Param('appDataId') appDataId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    const app = await this.catalog.requireAppByAppDataId(appDataId);
    const access = await this.access.authorizeCrud({
      app,
      environment: env,
      operation: 'delete',
      req,
    });
    return {
      row: await this.rows.deleteRow({
        appDataId,
        environment: env,
        table,
        id,
        principal: access.principal,
        ownerUserId: app.ownerUserId,
        skipPolicyCheck: access.skipPolicyCheck,
      }),
    };
  }
}
