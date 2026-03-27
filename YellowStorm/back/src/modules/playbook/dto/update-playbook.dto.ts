import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsNumber,
  IsBoolean,
  IsMongoId,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InputFileMetadataDto {
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  filepath?: string;

  @IsOptional()
  @IsString()
  language?: string;
}

export class InputFileDto {
  @IsOptional()
  @IsIn(['workspace', 'document'])
  type?: string;

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InputFileMetadataDto)
  metadata?: InputFileMetadataDto;
}

export class UpdatePlaybookTaskDto {
  @IsString()
  id!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  assignedAgentId?: string | null;

  @IsOptional()
  @IsNumber()
  executionOrder?: number;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @IsOptional()
  @IsBoolean()
  interruptBefore?: boolean;

  @IsOptional()
  @IsBoolean()
  interruptAfter?: boolean;

  @IsOptional()
  @IsBoolean()
  allowClarification?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  clarificationPrompt?: string;

  @IsOptional()
  @IsNumber()
  maxClarifications?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inputKeys?: string[];

  @IsOptional()
  @IsString()
  outputKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnComplete?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyEmails?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['live', 'replay_strict', 'replay_flex', 'replay_adaptive'])
  stepReplayMode?: string;

  @ApiPropertyOptional({ type: [InputFileDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InputFileDto)
  inputFiles?: InputFileDto[];
}

export class UpdatePlaybookEdgeDto {
  @IsString()
  id!: string;

  @IsString()
  sourceId!: string;

  @IsString()
  targetId!: string;
}

export class UpdatePlaybookDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [UpdatePlaybookTaskDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpdatePlaybookTaskDto)
  tasks?: UpdatePlaybookTaskDto[];

  @ApiPropertyOptional({ type: [UpdatePlaybookEdgeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpdatePlaybookEdgeDto)
  edges?: UpdatePlaybookEdgeDto[];

  @ApiPropertyOptional({ type: [String], description: 'Workspace IDs to attach' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];
}
