import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from '../services/audit-log.service';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { AuditLogResponse } from '../interfaces/audit-log.interface';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { Permissions } from '../constants/permissions';

@ApiTags('Audit Logs (Admin)')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permissions.ADMIN_AUDIT_READ)
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get audit logs with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  async findAll(@Query() query: AuditLogQueryDto): Promise<{
    logs: AuditLogResponse[];
    total: number;
    hasMore: boolean;
  }> {
    return this.auditLogService.findAll({
      actorId: query.actorId,
      actorEmail: query.actorEmail,
      action: query.action,
      feature: query.feature,
      targetType: query.targetType,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit,
      skip: query.skip,
    });
  }

  @Get('actions')
  @ApiOperation({ summary: 'Get distinct action values for filtering' })
  @ApiResponse({ status: 200, description: 'Actions retrieved' })
  async getActions(): Promise<string[]> {
    return this.auditLogService.getDistinctActions();
  }

  @Get('features')
  @ApiOperation({ summary: 'Get distinct features/namespaces for filtering' })
  @ApiResponse({ status: 200, description: 'Features retrieved' })
  async getFeatures(): Promise<string[]> {
    return this.auditLogService.getDistinctFeatures();
  }
}
