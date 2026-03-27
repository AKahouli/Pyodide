import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { RagType } from '../schemas/workspace-setting.schema';

export class CreateWorkspaceSettingDto {
  @ApiProperty({ description: 'Setting name', example: 'Default RAG Config', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Setting description', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Tag for categorization', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  tag?: string;

  @ApiPropertyOptional({ description: 'Model ID (deprecated – no longer used for indexing)', deprecated: true })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: 'Make this setting a public template', default: false })
  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;

  @ApiPropertyOptional({ description: 'Mark as predefined admin template (admin only)', default: false })
  @IsBoolean()
  @IsOptional()
  isPredefined?: boolean;

  @ApiPropertyOptional({ description: 'System instruction/prompt', maxLength: 10000 })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  instruction?: string;

  @ApiPropertyOptional({ description: 'Number of chunks to retrieve', minimum: 1, maximum: 100, default: 5 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  chunks?: number;

  @ApiPropertyOptional({ description: 'Enable hybrid search', default: false })
  @IsBoolean()
  @IsOptional()
  hybridSearch?: boolean;

  @ApiPropertyOptional({ description: 'RAG type', enum: RagType, default: RagType.STANDARD })
  @IsEnum(RagType)
  @IsOptional()
  ragType?: RagType;

  @ApiPropertyOptional({ description: 'Maximum tokens', minimum: 100, maximum: 128000, default: 4096 })
  @IsNumber()
  @IsOptional()
  @Min(100)
  @Max(128000)
  maxToken?: number;

  @ApiPropertyOptional({ description: 'Top K results', minimum: 1, maximum: 100, default: 10 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  topK?: number;
}
