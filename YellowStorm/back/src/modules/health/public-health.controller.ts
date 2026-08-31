import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimitSkip } from '../rate-limiter';
import { HealthService } from './health.service';

interface PublicHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'ok' | 'not_ready';
  timestamp: string;
  components?: Record<string, boolean>;
}

@ApiTags('health')
@Public()
@RateLimitSkip()
@Controller('health')
export class PublicHealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<PublicHealthResponse> {
    const result = await this.healthService.check();
    if (result.status === 'unhealthy') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: result.status,
      timestamp: result.timestamp,
      components: Object.fromEntries(
        Object.entries(result.checks).map(([name, detail]) => [name, detail.status !== 'down']),
      ),
    };
  }

  @Get('live')
  async liveness(): Promise<PublicHealthResponse> {
    const result = await this.healthService.liveness();
    return { status: result.status, timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<PublicHealthResponse> {
    const result = await this.healthService.readiness();
    if (result.status === 'not_ready') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: result.status, timestamp: new Date().toISOString(), components: result.checks };
  }
}
