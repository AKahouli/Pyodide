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
} from 'class-validator';
import { MAX_PLAUSIBLE_STAGE_MS } from '../interfaces/latency.interface';

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
}
