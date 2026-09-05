import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateResponseCorrectionSettingsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  threshold!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  maxAttempts!: number;

  @ApiProperty({ minimum: 10000 })
  @IsInt()
  @Min(10000)
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

  @ApiProperty({ enum: ['publish_with_warning', 'abstain', 'require_human_review'] })
  @IsIn(['publish_with_warning', 'abstain', 'require_human_review'])
  failureBehavior!: 'publish_with_warning' | 'abstain' | 'require_human_review';

  @ApiProperty()
  @IsBoolean()
  showOriginalAnswer!: boolean;
}

export class UpdateResponseReliabilitySettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: ['informative', 'corrective_transparent', 'corrective_guarded'] })
  @IsIn(['informative', 'corrective_transparent', 'corrective_guarded'])
  mode!: 'informative' | 'corrective_transparent' | 'corrective_guarded';

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  judgeModelId!: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  maxConcurrentEvaluations!: number;

  @ApiProperty({ minimum: 5000 })
  @IsInt()
  @Min(5000)
  timeoutMs!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
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
