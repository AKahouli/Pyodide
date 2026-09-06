import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_PLAUSIBLE_STAGE_MS } from '../interfaces/latency.interface';

/**
 * Browser-reported client streaming counters (Phase 0 telemetry): the
 * click→POST span, Shiki highlight work, and ingestion-queue coalescing.
 * Every field is optional so older clients stay valid; the JSONB merge
 * persists the object verbatim alongside the accepted paint metric.
 */
export class ClientStreamMetricsDto {
  @ApiPropertyOptional({ description: 'store sendMessage entry → POST dispatch' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_STAGE_MS)
  clickToPostMs?: number;

  @ApiPropertyOptional({ description: 'Shiki codeToHtml invocations in the turn window' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  shikiHighlightCalls?: number;

  @ApiPropertyOptional({ description: 'accumulated codeToHtml wall time' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_STAGE_MS)
  shikiHighlightMs?: number;

  @ApiPropertyOptional({ description: 'largest highlighted code input, in characters' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  shikiHighlightMaxChars?: number;

  @ApiPropertyOptional({ description: 'ingestion queue: events accepted' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  queueEventsReceived?: number;

  @ApiPropertyOptional({ description: 'ingestion queue: flush commits' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  queueFlushes?: number;

  @ApiPropertyOptional({ description: 'ingestion queue: events applied via flush batches' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  queueCoalescedEvents?: number;

  @ApiPropertyOptional({ description: 'deepest pending queue depth' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  queueMaxDepth?: number;

  @ApiPropertyOptional({ description: 'slowest flush application, in milliseconds' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_STAGE_MS)
  queueMaxFlushDurationMs?: number;

  @ApiPropertyOptional({ description: 'store transactions from the ingestion path' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  storeCommits?: number;
}

/**
 * Browser-reported sixth latency metric (frontend first-chunk paint) for an
 * AI message. The value is merged idempotently into the message's
 * latency_metrics JSONB; duplicates never overwrite the accepted value.
 */
export class ReportFrontendLatencyDto {
  @ApiProperty({ example: 1 })
  @IsIn([1], { message: 'Only latency metrics schemaVersion 1 is supported' })
  schemaVersion!: 1;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  requestId!: string;

  @ApiProperty({ description: 'Epoch milliseconds of the first model-derived chunk paint' })
  @IsNumber()
  @IsPositive()
  frontendFirstChunkPaintedEpochMs!: number;

  @ApiProperty({ description: 'backend SSE write → first paint, in milliseconds' })
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_STAGE_MS)
  frontendRenderMs!: number;

  @ApiPropertyOptional({ description: 'Diagnostic: SSE arrival → first paint, browser-monotonic' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_STAGE_MS)
  browserRenderOnlyMs?: number;

  @ApiProperty({ enum: ['ok', 'partial', 'clock-skew'] })
  @IsIn(['ok', 'partial', 'clock-skew'])
  quality!: 'ok' | 'partial' | 'clock-skew';

  @ApiPropertyOptional({ description: 'Optional client streaming counters (click→POST, Shiki, queue)', type: ClientStreamMetricsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientStreamMetricsDto)
  clientMetrics?: ClientStreamMetricsDto;
}
