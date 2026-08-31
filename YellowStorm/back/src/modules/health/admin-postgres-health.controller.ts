import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions, PermissionsGuard, RequirePermissions } from '../authorization';
import { PostgresHealthService } from './postgres-health.service';
import type { PostgresDiagnostics } from './postgres-health.service';

@ApiTags('admin-health')
@ApiBearerAuth()
@Controller('admin/health/postgres')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permissions.SYSTEM_MAINTENANCE)
export class AdminPostgresHealthController {
  constructor(private readonly postgresHealth: PostgresHealthService) {}

  @Get()
  getDiagnostics(): Promise<PostgresDiagnostics> {
    return this.postgresHealth.getDiagnostics();
  }
}
