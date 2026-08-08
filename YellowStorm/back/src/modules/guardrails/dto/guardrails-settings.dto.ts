import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class UpdatePromptInjectionGuardrailsDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  inputEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  outputEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['monitor', 'balanced', 'strict'], default: 'balanced' })
  @IsOptional()
  @IsIn(['monitor', 'balanced', 'strict'])
  mode?: 'monitor' | 'balanced' | 'strict';

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  inputClassifierPrompt?: string;

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  outputClassifierPrompt?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  blockMessage?: string;
}

export class UpdateToolActionReviewDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ['monitor', 'balanced', 'strict'], default: 'balanced' })
  @IsOptional()
  @IsIn(['monitor', 'balanced', 'strict'])
  mode?: 'monitor' | 'balanced' | 'strict';

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  classifierPrompt?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  blockMessage?: string;
}

export class UpdateGuardrailsSettingsDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  forceActivation?: boolean;

  @ApiPropertyOptional({ type: UpdatePromptInjectionGuardrailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePromptInjectionGuardrailsDto)
  promptInjection?: UpdatePromptInjectionGuardrailsDto;

  @ApiPropertyOptional({ type: UpdateToolActionReviewDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateToolActionReviewDto)
  toolActionReview?: UpdateToolActionReviewDto;
}
