import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsMongoId,
  Matches,
  MinLength,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AgentConnectorActionSelectionDto } from './connector-action-selection.dto';
import { AgentWidgetSettingsDto } from './widget-settings.dto';

export class PromptInjectionGuardrailsDto {
  @ApiPropertyOptional({ description: 'Enable input prompt injection guardrail', default: false })
  @IsOptional()
  @IsBoolean()
  inputGuardrailEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable output prompt injection guardrail', default: false })
  @IsOptional()
  @IsBoolean()
  outputGuardrailEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable tool-call prompt injection guardrail', default: false })
  @IsOptional()
  @IsBoolean()
  toolCallGuardrailEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Input classifier policy prompt', maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  inputClassifierPrompt?: string;

  @ApiPropertyOptional({ description: 'Output classifier policy prompt', maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  outputClassifierPrompt?: string;

  @ApiPropertyOptional({ description: 'Tool-call classifier policy prompt', maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  toolCallClassifierPrompt?: string;

  @ApiPropertyOptional({ description: 'Message returned when a request is blocked', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  blockMessage?: string;
}

export class AgentGuardrailsDto {
  @ApiPropertyOptional({ type: PromptInjectionGuardrailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PromptInjectionGuardrailsDto)
  promptInjection?: PromptInjectionGuardrailsDto;

}

export class AgentDeploymentSettingsDto {
  @ApiPropertyOptional({ description: 'Enable website embed deployment mode', default: false })
  @IsOptional()
  @IsBoolean()
  embedEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable REST API deployment mode', default: false })
  @IsOptional()
  @IsBoolean()
  restEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Public embedded webchat appearance and content settings', type: AgentWidgetSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentWidgetSettingsDto)
  widget?: AgentWidgetSettingsDto;
}

export class CreateAgentDto {
  @ApiProperty({ description: 'Agent name (alphanumeric and spaces)', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name!: string;

  @ApiProperty({ description: 'Agent slug', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  slug!: string;

  @ApiProperty({ description: 'Agent type ID (MongoDB ObjectId)' })
  @IsMongoId()
  agentType!: string;

  @ApiProperty({ description: 'Agent role/prompt', maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  role!: string;

  @ApiPropertyOptional({ description: 'Agent description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Temperature (0-1)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  temperature?: number;

  @ApiPropertyOptional({ description: 'Model ID', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ description: 'Additional instructions', maxLength: 50000 })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  instruction?: string;

  @ApiPropertyOptional({ description: 'Ignore agent type pre-prompt', default: false })
  @IsOptional()
  @IsBoolean()
  ignorePrePrompt?: boolean;

  @ApiPropertyOptional({ description: 'Knowledge base workspace IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  knowledgeBases?: string[];

  @ApiPropertyOptional({ description: 'Tool IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  tools?: string[];

  @ApiPropertyOptional({ description: 'Skill IDs directly attached to the agent', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: 'Inherited skill IDs disabled for this agent', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  disabledSkills?: string[];

  @ApiPropertyOptional({ description: 'Connector IDs attached to this agent', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  connectors?: string[];

  @ApiPropertyOptional({
    description: 'Optional per-connector action restrictions. Missing selection means all connector tools are allowed.',
    type: [AgentConnectorActionSelectionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentConnectorActionSelectionDto)
  connectorActionSelections?: AgentConnectorActionSelectionDto[];

  @ApiPropertyOptional({ description: 'Whether the agent is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is the default agent for its type', default: false })
  @IsOptional()
  @IsBoolean()
  isDefaultForType?: boolean;

  @ApiPropertyOptional({ description: 'Agent guardrails configuration', type: AgentGuardrailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentGuardrailsDto)
  guardrails?: AgentGuardrailsDto;

  @ApiPropertyOptional({ description: 'Agent deployment channel settings', type: AgentDeploymentSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentDeploymentSettingsDto)
  deploymentSettings?: AgentDeploymentSettingsDto;
}
