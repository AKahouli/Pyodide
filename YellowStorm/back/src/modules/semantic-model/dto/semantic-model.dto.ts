import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
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
  @Matches(/\S/)
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

export class SourceFieldMappingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceField!: string | null;

  // Empty when mode='ignore'; service validates non-empty targets for direct/constant modes.
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetAttribute!: string;

  @ApiProperty({ enum: ['direct', 'extract', 'metadata', 'constant', 'ignore'] })
  @IsIn(['direct', 'extract', 'metadata', 'constant', 'ignore'])
  mode!: 'direct' | 'extract' | 'metadata' | 'constant' | 'ignore';

  @ApiPropertyOptional()
  @IsOptional()
  constantValue?: unknown;

  // Only meaningful for mode='extract'; ignored otherwise.
  @ApiPropertyOptional({ enum: ['deterministic', 'ai'] })
  @IsOptional()
  @IsIn(['deterministic', 'ai'])
  extractionStrategy?: 'deterministic' | 'ai';
}

export class CreateSourceMappingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty()
  @IsUUID()
  conceptId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  documentId!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;

  @ApiPropertyOptional({ enum: ['excel_sheet', 'csv', 'document'] })
  @IsOptional()
  @IsIn(['excel_sheet', 'csv', 'document'])
  assetKind?: 'excel_sheet' | 'csv' | 'document';

  @ApiProperty({ type: [SourceFieldMappingDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SourceFieldMappingDto)
  fieldMappings!: SourceFieldMappingDto[];

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  identityFields?: string[];
}

export class SourceMappingPreviewDto {
  @ApiProperty()
  @IsUUID()
  conceptId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  documentId!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;

  @ApiPropertyOptional({ enum: ['excel_sheet', 'csv', 'document'] })
  @IsOptional()
  @IsIn(['excel_sheet', 'csv', 'document'])
  assetKind?: 'excel_sheet' | 'csv' | 'document';

  @ApiProperty({ type: [SourceFieldMappingDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SourceFieldMappingDto)
  fieldMappings!: SourceFieldMappingDto[];

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  identityFields?: string[];

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class DocumentSourceRefDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  documentId!: string;
}

export class BulkDocumentSourceMappingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty()
  @IsUUID()
  conceptId!: string;

  @ApiProperty({ type: [DocumentSourceRefDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DocumentSourceRefDto)
  documents!: DocumentSourceRefDto[];

  @ApiProperty({ type: [SourceFieldMappingDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SourceFieldMappingDto)
  fieldMappings!: SourceFieldMappingDto[];

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  identityFields?: string[];
}

export class SourceAssetProfileQueryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  workspaceId!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;
}

export class SaveRelationResolutionRuleDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty()
  @IsUUID()
  relationId!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sourceAttribute!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  targetAttribute!: string;

  @ApiProperty({ enum: ['exact', 'case_insensitive', 'normalized'] })
  @IsIn(['exact', 'case_insensitive', 'normalized'])
  strategy!: 'exact' | 'case_insensitive' | 'normalized';

  @ApiProperty({ enum: ['review', 'unresolved'] })
  @IsIn(['review', 'unresolved'])
  ambiguityPolicy!: 'review' | 'unresolved';
}

export class SourcePriorityDto {
  @ApiProperty()
  @IsUUID()
  mappingId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  rank!: number;
}

export class SaveSourceResolutionPolicyDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: [SourcePriorityDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SourcePriorityDto)
  priorities!: SourcePriorityDto[];

  @ApiProperty({ enum: ['primary_then_fallback'] })
  @IsIn(['primary_then_fallback'])
  defaultStrategy!: 'primary_then_fallback';
}

export class DataPreviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conceptId?: string;

  @ApiPropertyOptional({ default: 25, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dataRevisionId?: string;
}

export class ListReviewItemsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'resolved'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status: 'open' | 'resolved' = 'open';
}

export class ResolveReviewItemDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ enum: ['accepted', 'dismissed', 'leave_unresolved'] })
  @IsIn(['accepted', 'dismissed', 'leave_unresolved'])
  decision!: 'accepted' | 'dismissed' | 'leave_unresolved';

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  selectedTargetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  selectedMappingId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PopulationRefreshScopeDto {
  @ApiProperty({ enum: ['model', 'mapping'] })
  @IsIn(['model', 'mapping'])
  kind!: 'model' | 'mapping';

  @ApiPropertyOptional({ description: 'Required when kind is mapping' })
  @ValidateIf((scope: PopulationRefreshScopeDto) => scope.kind === 'mapping')
  @IsDefined()
  @IsUUID()
  mappingId?: string;
}

export class RequestPopulationRefreshDto {
  @ApiProperty({ enum: ['build', 'refresh'] })
  @IsIn(['build', 'refresh'])
  purpose!: 'build' | 'refresh';

  @ApiProperty({ description: 'Whole model or one mapping', example: { kind: 'model' } })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PopulationRefreshScopeDto)
  scope!: PopulationRefreshScopeDto;
}
