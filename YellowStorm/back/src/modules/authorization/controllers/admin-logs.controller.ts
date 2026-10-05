import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LogBufferService, LogLevelEnum, LogQueryResult, LogEntry } from '@modules/logger';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { Permissions } from '../constants/permissions';
import { LogQueryDto } from '../dto';

@ApiTags('Logs (Admin)')
@ApiBearerAuth()
@Controller('admin/logs')
@UseGuards(PermissionsGuard)
export class AdminLogsController {
  constructor(
    private readonly logBuffer: LogBufferService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.ADMIN_LOGS_READ)
  @ApiOperation({ summary: 'Query application logs' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async findLogs(@Query() query: LogQueryDto): Promise<LogQueryResult<LogEntry>> {
    const options: any = {
      page: query.page,
      limit: query.limit,
      sort: query.sort,
    };

    // Add level filter
    if (query.level) {
      const levels = query.level.split(',') as LogLevelEnum[];
      options.level = levels.length === 1 ? levels[0] : levels;
    }

    // Add other filters
    if (query.context) options.context = query.context;
    if (query.message) options.message = query.message;
    if (query.requestId) options.requestId = query.requestId;
    if (query.from) options.from = query.from;
    if (query.to) options.to = query.to;

    return this.logBuffer.findLogs(options);
  }

  @Get('levels')
  @RequirePermissions(Permissions.ADMIN_LOGS_READ)
  @ApiOperation({ summary: 'Get distinct log levels' })
  @ApiResponse({ status: 200, description: 'Log levels retrieved' })
  async getLevels(): Promise<string[]> {
    return this.logBuffer.getDistinctValues('level');
  }

  @Get('contexts')
  @RequirePermissions(Permissions.ADMIN_LOGS_READ)
  @ApiOperation({ summary: 'Get distinct log contexts' })
  @ApiResponse({ status: 200, description: 'Log contexts retrieved' })
  async getContexts(): Promise<string[]> {
    return this.logBuffer.getDistinctValues('context');
  }

  @Get('counts')
  @RequirePermissions(Permissions.ADMIN_LOGS_READ)
  @ApiOperation({ summary: 'Get log counts by level' })
  @ApiResponse({ status: 200, description: 'Log counts retrieved' })
  async getCounts(): Promise<Record<string, number>> {
    return this.logBuffer.getCountsByLevel();
  }

  /**
   * Read-side cutover status (P07): this API serves HISTORIC rows only; live events are in
   * Grafana. Never present an empty historic query as evidence about recent failures.
   */
  @Get('capabilities')
  @RequirePermissions(Permissions.ADMIN_LOGS_READ)
  @ApiOperation({ summary: 'Read-side cutover status and live-log navigation' })
  async getCapabilities(): Promise<{
    historicOnly: boolean;
    historicCutoverAt: string | null;
    liveLogsUrl: string | null;
    note: string;
  }> {
    const cutoverAt = this.configService.get<string | null>('logging.historicCutoverAt') ?? null;
    const baseUrl = this.configService.get<string | null>('logging.grafanaBaseUrl') ?? null;
    const uid = this.configService.get<string | null>('logging.grafanaDashboardUid') ?? null;
    // URL is built only from allowlisted configured values (never user input): no open redirect.
    const liveLogsUrl = baseUrl && uid ? `${baseUrl.replace(/\/+$/, '')}/d/${encodeURIComponent(uid)}` : null;
    return {
      historicOnly: true,
      historicCutoverAt: cutoverAt,
      liveLogsUrl,
      note: 'Events after the cutover timestamp are served by Grafana, not this API. An empty historic result does not mean no recent failures occurred.',
    };
  }
}
