import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

const REMEDIATION_CATEGORIES = ['structure', 'prompt', 'contract', 'handoff', 'tooling', 'evidence', 'outputFormat', 'format', 'hitl', 'determinism', 'expected_result'] as const;
const REMEDIATION_MODES = ['optimize-step', 'update-current', 'generate-new'] as const;

export class PreviewAdvisorRemediationItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ enum: REMEDIATION_CATEGORIES })
  @IsIn(REMEDIATION_CATEGORIES)
  category!: typeof REMEDIATION_CATEGORIES[number];

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  description!: string;
}

export class PreviewAdvisorRemediationDto {
  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiProperty({ enum: REMEDIATION_MODES })
  @IsIn(REMEDIATION_MODES)
  mode!: typeof REMEDIATION_MODES[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetTaskId?: string;

  @ApiProperty({ type: [PreviewAdvisorRemediationItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewAdvisorRemediationItemDto)
  items!: PreviewAdvisorRemediationItemDto[];
}
