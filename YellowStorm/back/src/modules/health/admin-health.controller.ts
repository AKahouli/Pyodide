import { Controller, Get, HttpStatus, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions, PermissionsGuard, RequirePermissions } from '../authorization';
import { HealthHistoryService } from './health-history.service';
import { HealthService } from './health.service';

@ApiTags('admin-health')
@ApiBearerAuth()
@Controller('admin/health')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
export class AdminHealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly healthHistoryService: HealthHistoryService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.check();
    if (result.status === 'unhealthy') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  @Get('history')
  getHistory(
    @Query('minutes') minutes?: string,
    @Query('status') status?: 'healthy' | 'unhealthy' | 'degraded',
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.healthHistoryService.getHistory({
      minutes: minutes ? Number.parseInt(minutes, 10) : undefined,
      status,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      skip: skip ? Number.parseInt(skip, 10) : undefined,
    });
  }

  @Get('stats')
  getStats(@Query('minutes') minutes?: string) {
    return this.healthHistoryService.getStats(minutes ? Number.parseInt(minutes, 10) : undefined);
  }
}
