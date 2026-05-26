import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ReplayReasoningStageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stageKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stageType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

class ReplayContextVariableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['task', 'input_context', 'tool_args', 'unknown'] })
  @IsOptional()
  @IsIn(['task', 'input_context', 'tool_args', 'unknown'])
  source?: 'task' | 'input_context' | 'tool_args' | 'unknown';

  @ApiPropertyOptional({ enum: ['string', 'number', 'boolean', 'array', 'object', 'unknown'] })
  @IsOptional()
  @IsIn(['string', 'number', 'boolean', 'array', 'object', 'unknown'])
  valueType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

class ReplayToolTraceTemplateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toolName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  argumentShape?: Record<string, unknown>;
}

class ReplayDriftPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireSameIntent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireSameReasoningStages?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireSameToolOrder?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowAdditionalTools?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowArgumentValueChanges?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enforceOutputContract?: boolean;
}

export class UpdateTaskReplayTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  intentKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  intentLabel?: string;

  @ApiPropertyOptional({ type: () => [ReplayReasoningStageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplayReasoningStageDto)
  reasoningOutline?: ReplayReasoningStageDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stableReasoningRules?: string[];

  @ApiPropertyOptional({ type: () => [ReplayContextVariableDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplayContextVariableDto)
  contextVariableSchema?: ReplayContextVariableDto[];

  @ApiPropertyOptional({ type: () => [ReplayToolTraceTemplateItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplayToolTraceTemplateItemDto)
  toolTraceTemplate?: ReplayToolTraceTemplateItemDto[];

  @ApiPropertyOptional({ type: () => ReplayDriftPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReplayDriftPolicyDto)
  driftPolicy?: ReplayDriftPolicyDto;
}
