import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSemanticModelDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  workspaceIds?: string[];
}

export class UpdateSemanticModelDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class SemanticModelQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['workspace_default', 'designed'] })
  @IsOptional()
  @IsIn(['workspace_default', 'designed'])
  kind?: 'workspace_default' | 'designed';

  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workspace?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class GraphOperationsDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: [Object] })
  @Type(() => Object)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsObject({ each: true })
  operations!: Record<string, unknown>[];
}

export class AgeGraphOperationsDto {
  @ApiProperty({ type: [Object], description: 'AGE graph mutations: node.create, node.delete, edge.create or edge.delete' })
  @Type(() => Object)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsObject({ each: true })
  operations!: Record<string, unknown>[];
}

export class ConnectWorkspaceDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiProperty()
  @IsString()
  workspaceId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  addToDocumentsFallback?: boolean;
}

export class CreateBindingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiProperty({ enum: ['model', 'node_type', 'relation_type', 'record'] })
  @IsIn(['model', 'node_type', 'relation_type', 'record'])
  targetKind!: 'model' | 'node_type' | 'relation_type' | 'record';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiProperty({ enum: ['workspace', 'document'] })
  @IsIn(['workspace', 'document'])
  resourceKind!: 'workspace' | 'document';

  @ApiProperty()
  @IsString()
  workspaceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiProperty({ enum: ['dynamic', 'explicit'] })
  @IsIn(['dynamic', 'explicit'])
  inclusionMode!: 'dynamic' | 'explicit';

  @ApiPropertyOptional({ enum: ['broad', 'targeted', 'evidence_only'] })
  @IsOptional()
  @IsIn(['broad', 'targeted', 'evidence_only'])
  retrievalMode?: 'broad' | 'targeted' | 'evidence_only';

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;
}

export class UpdateBindingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiPropertyOptional({ enum: ['broad', 'targeted', 'evidence_only'] })
  @IsOptional()
  @IsIn(['broad', 'targeted', 'evidence_only'])
  retrievalMode?: 'broad' | 'targeted' | 'evidence_only';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CloneSemanticModelDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
}

export class SemanticRecordQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  nodeTypeId?: string;
}

export class ExpectedModelRevisionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class PublishSemanticModelDto extends ExpectedModelRevisionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedGraphRevision!: number;
}

export class GenerateSemanticModelOntologyDto {
  @ApiProperty({ type: [String], maxItems: 50, required: false, default: [] })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(4000, { each: true })
  businessRequirements: string[] = [];
}

export class SemanticModelManualInstancesDto {
  @ApiProperty()
  @IsUUID()
  nodeTypeId!: string;

  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  labels!: string[];
}

export class StartSemanticModelBuildDto {
  @ApiProperty({ type: [String], maxItems: 50, required: false, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(4000, { each: true })
  businessRequirements: string[] = [];

  @ApiPropertyOptional({ enum: ['replace', 'incremental'], default: 'replace' })
  @IsOptional()
  @IsIn(['replace', 'incremental'])
  applyMode: 'replace' | 'incremental' = 'replace';

  @ApiPropertyOptional({ type: [SemanticModelManualInstancesDto], maxItems: 100, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SemanticModelManualInstancesDto)
  manualInstances?: SemanticModelManualInstancesDto[];
}

export class UpdateBusinessRequirementsDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedGraphRevision!: number;

  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  businessRequirements!: Record<string, unknown>[];
}
