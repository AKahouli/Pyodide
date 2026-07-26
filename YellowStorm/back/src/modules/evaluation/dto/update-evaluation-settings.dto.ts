import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const EVALUATION_MODES = [
  'informative',
  'corrective_transparent',
  'corrective_guarded',
] as const;

const CORRECTION_FAILURE_BEHAVIORS = [
  'publish_with_warning',
  'abstain',
  'require_human_review',
] as const;

export class UpdateResponseCorrectionSettingsDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  threshold!: number;

  @ApiProperty({ minimum: 1, maximum: 3 })
  @IsInt()
  @Min(1)
  @Max(3)
  maxAttempts!: number;

  @ApiProperty({ minimum: 10000, maximum: 300000 })
  @IsInt()
  @Min(10000)
  @Max(300000)
  maxDurationMs!: number;

  @ApiProperty()
  @IsBoolean()
  allowAdditionalDocumentRetrieval!: boolean;

  @ApiProperty()
  @IsBoolean()
  allowConnectorQueries!: boolean;

  @ApiProperty()
  @IsBoolean()
  allowCalculationReruns!: boolean;

  @ApiProperty({ enum: CORRECTION_FAILURE_BEHAVIORS })
  @IsIn(CORRECTION_FAILURE_BEHAVIORS)
  failureBehavior!: (typeof CORRECTION_FAILURE_BEHAVIORS)[number];

  @ApiProperty()
  @IsBoolean()
  showOriginalAnswer!: boolean;
}

export class UpdateResponseReliabilitySettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: EVALUATION_MODES })
  @IsIn(EVALUATION_MODES)
  mode!: (typeof EVALUATION_MODES)[number];

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  judgeModelId!: string | null;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxConcurrentEvaluations!: number;

  @ApiProperty({ minimum: 5000, maximum: 120000 })
  @IsInt()
  @Min(5000)
  @Max(120000)
  timeoutMs!: number;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxFindings!: number;

  @ApiProperty({ type: UpdateResponseCorrectionSettingsDto })
  @ValidateNested()
  @Type(() => UpdateResponseCorrectionSettingsDto)
  correction!: UpdateResponseCorrectionSettingsDto;
}

export class UpdateEvaluationSettingsDto {
  @ApiProperty({ type: UpdateResponseReliabilitySettingsDto })
  @ValidateNested()
  @Type(() => UpdateResponseReliabilitySettingsDto)
  responseReliability!: UpdateResponseReliabilitySettingsDto;
}
