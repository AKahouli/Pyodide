import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  GoneException,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from './health.service';
import {
  HealthHistoryService,
  HealthHistoryResponse,
  HealthHistoryStats,
} from './health-history.service';
import { HealthCheckResult } from './interfaces/health.interface';
import { RateLimitSkip } from '../rate-limiter';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth';
import { UserDocument } from '../user';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly healthHistoryService: HealthHistoryService,
  ) {}
  @Get()
  @RateLimitSkip()
  @ApiOperation({ summary: 'Full health check with all system metrics' })
  @ApiResponse({ status: 200, description: 'System is healthy' })
  @ApiResponse({ status: 503, description: 'System is unhealthy' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    const result = await this.healthService.check();
    // Return 503 Service Unavailable for unhealthy status
    if (result.status === 'unhealthy') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
  @Get('live')
  @RateLimitSkip()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  async liveness(): Promise<{ status: 'ok' }> {
    return this.healthService.liveness();
  }

  @Get('ready')
  @RateLimitSkip()
  @ApiOperation({ summary: 'Readiness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is ready to receive traffic' })
  @ApiResponse({ status: 503, description: 'Application is not ready' })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'not_ready'; checks: Record<string, boolean> }> {
    const result = await this.healthService.readiness();

    // Return 503 Service Unavailable when not ready
    if (result.status === 'not_ready') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }

  @Get('history')
  @RateLimitSkip()
  @ApiOperation({ summary: 'Get health check history' })
  @ApiQuery({
    name: 'minutes',
    required: false,
    type: Number,
    description: 'Time range in minutes (default: 60)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['healthy', 'unhealthy', 'degraded'],
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Limit results (default: 100, max: 1000)',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number, description: 'Skip for pagination' })
  @ApiResponse({ status: 200, description: 'Health history records' })
  async getHistory(
    @Query('minutes') minutes?: string,
    @Query('status') status?: 'healthy' | 'unhealthy' | 'degraded',
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ): Promise<HealthHistoryResponse> {
    return this.healthHistoryService.getHistory({
      minutes: minutes ? Number.parseInt(minutes, 10) : undefined,
      status,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      skip: skip ? Number.parseInt(skip, 10) : undefined,
    });
  }

  @Get('stats')
  @RateLimitSkip()
  @ApiOperation({ summary: 'Get aggregated health statistics' })
  @ApiQuery({
    name: 'minutes',
    required: false,
    type: Number,
    description: 'Time range in minutes (default: 60)',
  })
  @ApiResponse({ status: 200, description: 'Health statistics' })
  async getStats(@Query('minutes') minutes?: string): Promise<HealthHistoryStats> {
    return this.healthHistoryService.getStats(minutes ? Number.parseInt(minutes, 10) : undefined);
  }
  /*deprecated-start*/
  @Post('history/trigger')
  @RateLimitSkip()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Manually trigger a health check and save to history',
    deprecated: true,
  })
  @ApiResponse({ status: 201, description: 'Health check recorded' })
  async triggerCheck(): Promise<never> {
    throw new GoneException('This endpoint is deprecated. Use /health/history instead.');
  }
}
