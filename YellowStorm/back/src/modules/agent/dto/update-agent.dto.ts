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
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AgentConnectorActionSelectionDto } from './connector-action-selection.dto';

export class UpdateAgentDto {
  @ApiPropertyOptional({ description: 'Agent name (alphanumeric and spaces)', minLength: 2, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name?: string;

  @ApiPropertyOptional({ description: 'Agent slug', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  slug?: string;

  @ApiPropertyOptional({ description: 'Agent type ID (MongoDB ObjectId)' })
  @IsOptional()
  @IsMongoId()
  agentType?: string;

  @ApiPropertyOptional({ description: 'Agent role/prompt', maxLength: 50000 })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  role?: string;

  @ApiPropertyOptional({ description: 'Agent description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Temperature (0-1)' })
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

  @ApiPropertyOptional({ description: 'Ignore agent type pre-prompt' })
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

  @ApiPropertyOptional({ description: 'Whether the agent is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is the default agent for its type', default: false })
  @IsOptional()
  @IsBoolean()
  isDefaultForType?: boolean;
}
