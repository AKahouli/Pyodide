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
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAgentDto {
  @ApiPropertyOptional({ description: 'Agent name (alphanumeric and spaces)', minLength: 2, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name?: string;

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

  @ApiPropertyOptional({ description: 'Whether the agent is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is the default agent for its type', default: false })
  @IsOptional()
  @IsBoolean()
  isDefaultForType?: boolean;
}
