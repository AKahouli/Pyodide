import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class UpdatePromptInjectionGuardrailsDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  inputGuardrailEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  outputGuardrailEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  toolCallGuardrailEnabled?: boolean;

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

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  toolCallClassifierPrompt?: string;

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
}
