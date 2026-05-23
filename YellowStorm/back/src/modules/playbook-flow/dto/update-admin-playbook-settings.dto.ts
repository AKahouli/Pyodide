import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

class UpdatePlaybookIntentNormalizationLimitsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxWorkflowPlanChanges?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxInputPorts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxOutputPorts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxIteratorBodySteps?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxIteratorBodyEdges?: number;
}

export class UpdateAdminPlaybookSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inferenceModelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  advisorEvaluationModelId?: string | null;

  @ApiPropertyOptional({ enum: ['auto', 'manual'] })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  nodeSuggestionsMode?: 'auto' | 'manual';

  @ApiPropertyOptional({ enum: ['auto', 'manual'] })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  approvalSuggestionMode?: 'auto' | 'manual';

  @ApiPropertyOptional({ type: UpdatePlaybookIntentNormalizationLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlaybookIntentNormalizationLimitsDto)
  intentNormalizationLimits?: UpdatePlaybookIntentNormalizationLimitsDto;
}
