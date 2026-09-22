import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { WorkyTraceService, IWorkyTraceResponse } from '../services/worky-trace.service';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions } from '../../authorization/constants/permissions';

class ListTracesQueryDto {
  @ApiPropertyOptional({ description: 'Set to "true" to include rawPayloadUri (admin only)' })
  @IsOptional()
  @IsString()
  includeRaw?: string;
}

/**
 * Trace persistence + redaction (Part 4 §6.1, canonical §19).
 *
 *   - `GET /worky/streams/{id}/traces` — owner view. Returns
 *     `rawPayloadUri=null` unless the caller has the
 *     `worky.admin.trace` permission.
 *   - `GET /worky/streams/{id}/traces/{taskId}` — per-task view,
 *     same redaction.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky')
export class WorkyTraceController {
  constructor(
    private readonly traces: WorkyTraceService,
  ) {}

  @Get('streams/:id/traces')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List traces for a Worky stream (rawPayloadUri redacted unless admin)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async listStreamTraces(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListTracesQueryDto,
  ): Promise<IWorkyTraceResponse[]> {
    const includeRaw = await this.userHasAdminTrace(user);
    return this.traces.listForStream(id, { redactRawPayload: !includeRaw });
  }

  @Get('streams/:id/traces/:taskId')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List traces for a single task' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  @ApiParam({ name: 'taskId', description: 'Task id' })
  async listTaskTraces(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ): Promise<IWorkyTraceResponse[]> {
    const includeRaw = await this.userHasAdminTrace(user);
    return this.traces.listForTask(id, taskId, { redactRawPayload: !includeRaw });
  }

  private async userHasAdminTrace(user: AuthUser): Promise<boolean> {
    // Keep the redaction check isolated. The auth module exposes
    // `userHasPermission`; for the MVP we just check role names
    // (`super_admin` / `worky_admin`) on the loaded user. Future
    // hardening: route through `PermissionsService.hasPermission`.
    const roleNames = (user as unknown as { roleNames?: string[] }).roleNames ?? [];
    return roleNames.includes('super_admin') || roleNames.includes('worky_admin');
  }

}
