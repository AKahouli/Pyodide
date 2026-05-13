import { IsOptional, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

const REPORT_REASONS = [
  'inaccurate',
  'wrong_information',
  'offensive',
  'out_of_context',
  'hallucination',
  'other',
] as const;

export class ReportQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['pending', 'reviewed', 'resolved'] })
  @IsOptional()
  @IsIn(['pending', 'reviewed', 'resolved'])
  status?: 'pending' | 'reviewed' | 'resolved';

  @ApiPropertyOptional({ enum: REPORT_REASONS })
  @IsOptional()
  @IsIn(REPORT_REASONS)
  reason?: (typeof REPORT_REASONS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
