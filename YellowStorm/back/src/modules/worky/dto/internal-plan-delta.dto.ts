import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PlanDeltaBodyDto } from './plan-delta-body.dto';

/**
 * Body shape for `POST /worky/internal/streams/{id}/plan-delta`.
 * `eventId` is the idempotency key (canonical §6.2) and is also accepted via
 * the `X-Event-Id` header — the service-auth guard reads the header and the
 * controller attaches it to the body for the handler. `basePlanVersion` is
 * the version the runtime observed; Part 2 enforces strict equality against
 * `WorkyStream.currentPlanVersion` and rejects with `stale_base_version`.
 */
export class InternalPlanDeltaDto {
  @ApiProperty({ description: 'Idempotency key — see WorkyIdempotencyRecord' })
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ description: 'Base plan version this delta applies against' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePlanVersion!: number;

  @ApiPropertyOptional({ type: PlanDeltaBodyDto, description: 'Validated delta body' })
  @IsOptional()
  body?: PlanDeltaBodyDto;

  @ApiPropertyOptional({ description: 'Reason / trigger for the replan (Part 4 §5)' })
  @IsOptional()
  @IsString()
  reason?: string;
}
