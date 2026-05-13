import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  constructor(private readonly logBuffer: LogBufferService) {}

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
}
