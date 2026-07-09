import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';

export class MarkGovernanceDryRunDto {
  @ApiProperty({ enum: ['passed', 'failed', 'needs_review'] })
  @IsIn(['passed', 'failed', 'needs_review'])
  status!: 'passed' | 'failed' | 'needs_review';

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  checks?: Record<string, unknown>;
}
