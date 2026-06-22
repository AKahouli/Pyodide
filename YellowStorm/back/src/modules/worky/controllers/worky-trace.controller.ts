import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { WorkyServiceAuthGuard } from '../guards/worky-service-auth.guard';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyIdempotencyService } from '../services/worky-idempotency.service';
import { WorkyAuditService } from '../services/worky-audit.service';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../../authorization/constants/permissions';
import { InternalTraceDto } from '../dto/internal-trace.dto';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  IWorkyCallbackAck,
} from '../interfaces/worky-stream.interface';

class ListTracesQueryDto {
  @ApiPropertyOptional({ description: 'Set to "true" to include rawPayloadUri (admin only)' })
  @IsOptional()
  @IsString()
  includeRaw?: string;
}

/**
 * Trace persistence + redaction (Part 4 §6.1, canonical §19).
 *
 *   - `POST /worky/internal/streams/{id}/trace` — runtime → backend
 *     callback. Idempotent on `(streamId, eventId)`. Persists
 *     `WorkyTrace` rows; the raw payload URI is admin-only and never
 *     returned to non-admin callers.
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
    private readonly streams: WorkyStreamService,
    private readonly idempotency: WorkyIdempotencyService,
    private readonly audit: WorkyAuditService,
  ) {}

  @Post('internal/streams/:id/trace')
  @UseGuards(WorkyServiceAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Runtime → NestJS trace callback' })
  async recordTrace(
    @Param('id') streamId: string,
    @Body() dto: InternalTraceDto,
  ): Promise<IWorkyCallbackAck & { traceId: string | null }> {
    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream not found.',
      );
    }
    const idem = await this.idempotency.claim(streamId, dto.eventId, 'trace');
    if (idem.replay) {
      return { ...this.ack(dto.eventId, true), traceId: null };
    }
    const trace = await this.traces.record({
      streamId,
      taskId: dto.taskId,
      kind: dto.kind as 'tool' | 'model',
      name: dto.name,
      summary: dto.summary,
      rawPayloadUri: dto.rawPayloadUri ?? null,
      durationMs: dto.durationMs,
    });
    await this.audit.append({
      streamId,
      action: 'runtime.trace',
      targetType: 'worky_trace',
      targetId: trace.id,
      details: { kind: dto.kind, name: dto.name, taskId: dto.taskId },
    });
    return { ...this.ack(dto.eventId, false), traceId: trace.id };
  }

  @Get('streams/:id/traces')
  @UseGuards(WorkyStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List traces for a Worky stream (rawPayloadUri redacted unless admin)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async listStreamTraces(
    @CurrentUser() user: UserDocument,
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
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ): Promise<IWorkyTraceResponse[]> {
    const includeRaw = await this.userHasAdminTrace(user);
    return this.traces.listForTask(id, taskId, { redactRawPayload: !includeRaw });
  }

  private async userHasAdminTrace(user: UserDocument): Promise<boolean> {
    // Keep the redaction check isolated. The auth module exposes
    // `userHasPermission`; for the MVP we just check role names
    // (`super_admin` / `worky_admin`) on the loaded user. Future
    // hardening: route through `PermissionsService.hasPermission`.
    const roleNames = (user as unknown as { roleNames?: string[] }).roleNames ?? [];
    return roleNames.includes('super_admin') || roleNames.includes('worky_admin');
  }

  private ack(eventId: string, replay: boolean): IWorkyCallbackAck {
    return {
      applied: !replay,
      replay,
      eventId,
      receivedAt: new Date().toISOString(),
    };
  }
}
