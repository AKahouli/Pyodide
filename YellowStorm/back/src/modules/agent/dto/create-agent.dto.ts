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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgentDto {
  @ApiProperty({ description: 'Agent name (alphanumeric and spaces)', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name!: string;

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

  @ApiPropertyOptional({ description: 'Whether the agent is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is the default agent for its type', default: false })
  @IsOptional()
  @IsBoolean()
  isDefaultForType?: boolean;
}
