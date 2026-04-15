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
  IsEnum,
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

  @IsOptional()
  @IsString()
  mimeType?: string;
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
  @IsString()
  portId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InputFileMetadataDto)
  metadata?: InputFileMetadataDto;
}

export class TaskInputPortDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsEnum(['text', 'document', 'code', 'image', 'data', 'dashboard'])
  artifactKind!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class TaskOutputPortDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsEnum(['text', 'document', 'code', 'image', 'data', 'dashboard'])
  artifactKind!: string;

  @IsOptional()
  @IsString()
  description?: string;
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

  @IsOptional()
  @IsEnum(['generic', 'summarizer', 'docxgen', 'slidegen', 'codegen', 'analyzer'])
  taskType?: string;

  @ApiPropertyOptional({ type: [TaskInputPortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskInputPortDto)
  inputPorts?: TaskInputPortDto[];

  @ApiPropertyOptional({ type: [TaskOutputPortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskOutputPortDto)
  outputPorts?: TaskOutputPortDto[];

  @ApiPropertyOptional({ description: 'Connector tool bindings for this step', type: [Object] })
  @IsOptional()
  @IsArray()
  toolBindings?: Array<{
    id: string;
    connectorId: string;
    actions: Array<{ actionKey: string; isEnabled?: boolean }>;
    credentialId?: string | null;
    fixedParams?: Record<string, unknown>;
    disableAutoSkills?: boolean;
    isEnabled?: boolean;
  }>;
}

export class UpdatePlaybookEdgeDto {
  @IsString()
  id!: string;

  @IsString()
  sourceId!: string;

  @IsString()
  targetId!: string;

  @IsOptional()
  @IsString()
  sourceOutputPortId?: string;

  @IsOptional()
  @IsString()
  targetInputPortId?: string;
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
