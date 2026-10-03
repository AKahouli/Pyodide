import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
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

export class CloneSemanticModelIncludeDto {
  @ApiPropertyOptional({ default: true, description: 'Source links and extraction rules' })
  @IsOptional()
  @IsBoolean()
  sources?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Data already built (forces sources)' })
  @IsOptional()
  @IsBoolean()
  data?: boolean;

  @ApiPropertyOptional({ default: false, description: 'People the model is shared with (owner only)' })
  @IsOptional()
  @IsBoolean()
  shares?: boolean;
}

export class CloneSemanticModelDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  name!: string;

  @ApiPropertyOptional({ type: CloneSemanticModelIncludeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CloneSemanticModelIncludeDto)
  include?: CloneSemanticModelIncludeDto;
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

export class ExtractionPagesDto {
  @ApiProperty({ minimum: 1, maximum: 2000 })
  @IsInt() @Min(1) @Max(2000)
  from!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 2000, description: 'Last page read; the first one when omitted. At most 50 pages.' })
  @IsOptional() @IsInt() @Min(1) @Max(2000)
  to?: number;
}

export class ExtractionTakeDto {
  @ApiPropertyOptional({ enum: ['start', 'end'], default: 'start' })
  @IsOptional() @IsIn(['start', 'end'])
  from?: 'start' | 'end';

  @ApiProperty({ minimum: 1, maximum: 20000 })
  @IsInt() @Min(1) @Max(20000)
  count!: number;

  @ApiPropertyOptional({ enum: ['characters', 'words', 'lines'], default: 'characters' })
  @IsOptional() @IsIn(['characters', 'words', 'lines'])
  unit?: 'characters' | 'words' | 'lines';
}

/** Rules for reading one document field without AI. */
export class ExtractionRulesDto {
  @ApiPropertyOptional({ type: [String], maxItems: 10, description: 'Labels the value follows, e.g. "Contract No.", "N° de contrat"' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true })
  labels?: string[];

  @ApiPropertyOptional({ enum: ['auto', 'same_line', 'next_line', 'table', 'heading', 'anywhere', 'after_label', 'before_label', 'pages'],
    description: 'after_label / before_label read the whole passage after or before a label or heading; pages reads whole pages' })
  @IsOptional() @IsIn(['auto', 'same_line', 'next_line', 'table', 'heading', 'anywhere', 'after_label', 'before_label', 'pages'])
  location?: 'auto' | 'same_line' | 'next_line' | 'table' | 'heading' | 'anywhere' | 'after_label' | 'before_label' | 'pages';

  @ApiPropertyOptional({ maxLength: 200, description: 'Regular expression the value must match; its first group is kept when it has one' })
  @IsOptional() @IsString() @MaxLength(200)
  pattern?: string;

  @ApiPropertyOptional({ enum: ['none', 'trim', 'no_spaces', 'upper', 'lower', 'date_iso'], description: 'trim removes spaces, bullets and separators at both ends; no_spaces removes every space' })
  @IsOptional() @IsIn(['none', 'trim', 'no_spaces', 'upper', 'lower', 'date_iso'])
  transform?: 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso';

  @ApiPropertyOptional({ enum: ['unique', 'first'], description: 'Keep a value only when every match agrees, or keep the first' })
  @IsOptional() @IsIn(['unique', 'first'])
  occurrence?: 'unique' | 'first';

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  firstPageOnly?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 10, description: 'Where a passage stops (after_label) or starts (before_label)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true })
  boundaryLabels?: string[];

  @ApiPropertyOptional({ type: ExtractionPagesDto })
  @IsOptional() @ValidateNested() @Type(() => ExtractionPagesDto)
  pages?: ExtractionPagesDto;

  @ApiPropertyOptional({ type: ExtractionTakeDto, description: 'Keep only the first or last characters, words or lines of what was found' })
  @IsOptional() @ValidateNested() @Type(() => ExtractionTakeDto)
  take?: ExtractionTakeDto;
}

export class DocumentLabelsDto {
  @ApiProperty()
  @IsString() @MinLength(1)
  workspaceId!: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 10, description: 'A few of the source\'s documents to read labels from' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) @MinLength(1, { each: true })
  documentIds!: string[];
}

export class ComputedFieldInputDto {
  @ApiProperty({ enum: ['file', 'field'] })
  @IsIn(['file', 'field'])
  kind!: 'file' | 'field';

  // 'document_name' for a file input, another mapping's targetAttribute for a field input.
  @ApiProperty({ maxLength: 80 })
  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;
}

export class ComputedFieldDto {
  @ApiProperty({ type: () => ComputedFieldInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ComputedFieldInputDto)
  input!: ComputedFieldInputDto;

  @ApiProperty({ enum: ['split', 'between', 'regex'] })
  @IsIn(['split', 'between', 'regex'])
  method!: 'split' | 'between' | 'regex';

  @ApiPropertyOptional({ minLength: 1, maxLength: 10 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10)
  delimiter?: string;

  @ApiPropertyOptional({ minimum: -20, maximum: 20, description: 'Non-zero; negative counts from the end' })
  @IsOptional() @IsInt() @Min(-20) @Max(20)
  part?: number;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional() @IsString() @MaxLength(50)
  after?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional() @IsString() @MaxLength(50)
  before?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  pattern?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  template?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  stripExtension?: boolean;

  @ApiPropertyOptional({ type: ExtractionTakeDto, description: 'After the cut: keep only the first or last characters, words or lines' })
  @IsOptional() @ValidateNested() @Type(() => ExtractionTakeDto)
  take?: ExtractionTakeDto;

  @ApiPropertyOptional({ maxLength: 200, description: 'After the cut and take: a regular expression the value must match; its first group is kept when it has one' })
  @IsOptional() @IsString() @MaxLength(200)
  valuePattern?: string;

  @ApiPropertyOptional({ enum: ['none', 'trim', 'no_spaces', 'upper', 'lower', 'date_iso', 'year', 'number'] })
  @IsOptional() @IsIn(['none', 'trim', 'no_spaces', 'upper', 'lower', 'date_iso', 'year', 'number'])
  transform?: 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso' | 'year' | 'number';
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

  @ApiProperty({ enum: ['direct', 'extract', 'metadata', 'constant', 'computed', 'ignore'] })
  @IsIn(['direct', 'extract', 'metadata', 'constant', 'computed', 'ignore'])
  mode!: 'direct' | 'extract' | 'metadata' | 'constant' | 'computed' | 'ignore';

  @ApiPropertyOptional()
  @IsOptional()
  constantValue?: unknown;

  // Only meaningful for mode='extract'; ignored otherwise.
  @ApiPropertyOptional({ enum: ['deterministic', 'ai', 'rules_then_ai'] })
  @IsOptional()
  @IsIn(['deterministic', 'ai', 'rules_then_ai'])
  extractionStrategy?: 'deterministic' | 'ai' | 'rules_then_ai';

  @ApiPropertyOptional({ maxLength: 2000, description: 'AI reading: what the value means and what to look for; empty uses the attribute description' })
  @IsOptional() @IsString() @MaxLength(2000)
  semanticDefinition?: string;

  @ApiPropertyOptional({ maxLength: 64, description: 'AI reading: the agent asked to read the field; absent means the platform extraction agent' })
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  agentId?: string;

  @ApiPropertyOptional({ type: () => ExtractionRulesDto, description: 'Where a document value is and what it looks like' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractionRulesDto)
  rules?: ExtractionRulesDto;

  @ApiPropertyOptional({ type: () => ComputedFieldDto, description: 'How a computed document field is derived' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComputedFieldDto)
  computed?: ComputedFieldDto;
}

export class ComputedFieldPreviewDto {
  @ApiProperty({ type: () => ComputedFieldDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ComputedFieldDto)
  computed!: ComputedFieldDto;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 20 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(1000, { each: true })
  samples!: string[];
}

/** Limits on how much of a document the AI reads. Each one left out uses the admin default. */
export class AiExtractionSettingsDto {
  @ApiPropertyOptional({ minimum: 10, maximum: 500, description: 'Most blocks sent for one document (the extraction agent reads at most 500)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(500)
  maxBlocks?: number;

  @ApiPropertyOptional({ minimum: 2000, maximum: 400000, description: 'Most characters sent for one document' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(400000)
  maxCharacters?: number;

  @ApiPropertyOptional({ minimum: 1000, maximum: 2000000, description: 'Above this length, only the blocks about each field are sent' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1000) @Max(2000000)
  longDocumentCharacters?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, description: 'Blocks kept per field in a long document' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  blocksPerField?: number;

  @ApiPropertyOptional({ description: 'One document gives several records, one per item the AI finds (mapping only)' })
  @IsOptional() @IsBoolean()
  manyRecords?: boolean;
}

export class RunLimitsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50000, description: 'Most files one run reads (and one workspace source covers)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50000)
  maxRunSources?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 200000, description: 'Most records one source gives' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(200000)
  maxRecordsPerSource?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 200000, description: 'Most records one run keeps' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(200000)
  maxRecordsPerRun?: number;

  @ApiPropertyOptional({ minimum: 1000, maximum: 2000000, description: 'Most field values one run keeps' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1000) @Max(2000000)
  maxValuesPerRun?: number;
}

export class DerivedFieldMappingDto {
  @ApiProperty({ description: 'A field of the source concept' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceAttribute!: string;

  @ApiProperty({ description: 'The field of the derived concept it fills' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  targetAttribute!: string;
}

export class SaveDerivedSourceDto extends ExpectedModelRevisionDto {
  @ApiProperty({ description: 'The concept filled from another one' })
  @IsUUID()
  conceptId!: string;

  @ApiProperty({ description: 'The concept whose records carry the values' })
  @IsUUID()
  sourceConceptId!: string;

  @ApiProperty({ type: [DerivedFieldMappingDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DerivedFieldMappingDto)
  fieldMappings!: DerivedFieldMappingDto[];

  @ApiProperty({ type: [String], maxItems: 5, description: 'Fields of the derived concept that tell its records apart' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  identityFields!: string[];

  @ApiProperty({ enum: ['most_frequent', 'latest', 'longest', 'leave_empty'] })
  @IsIn(['most_frequent', 'latest', 'longest', 'leave_empty'])
  conflictRule!: 'most_frequent' | 'latest' | 'longest' | 'leave_empty';

  @ApiPropertyOptional({ description: 'The source field ordering records for the most recent rule' })
  @ValidateIf((dto: SaveDerivedSourceDto) => dto.conflictRule === 'latest')
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  orderBy?: string;
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

  @ApiPropertyOptional({ type: () => AiExtractionSettingsDto, description: 'Overrides the admin defaults for how much the AI reads' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiExtractionSettingsDto)
  aiSettings?: AiExtractionSettingsDto;
}

/** A named copy of how a concept is read from documents, to reuse on other documents or workspaces. */
export class SaveMappingPresetDto {
  @ApiProperty()
  @IsUUID()
  conceptId!: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

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

  @ApiPropertyOptional({ type: () => AiExtractionSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiExtractionSettingsDto)
  aiSettings?: AiExtractionSettingsDto;
}

export class MappingPresetQueryDto {
  @ApiProperty()
  @IsUUID()
  conceptId!: string;
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

  @ApiPropertyOptional({ type: () => AiExtractionSettingsDto, description: 'Overrides the admin defaults for how much the AI reads' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiExtractionSettingsDto)
  aiSettings?: AiExtractionSettingsDto;
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

  @ApiPropertyOptional({ type: () => AiExtractionSettingsDto, description: 'Overrides the admin defaults for how much the AI reads' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiExtractionSettingsDto)
  aiSettings?: AiExtractionSettingsDto;
}

/** One document mapping applied to every readable file of a workspace, or of one of its folders. */
export class WorkspaceSourceMappingDto {
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
  @MaxLength(200)
  workspaceId!: string;

  @ApiPropertyOptional({ description: 'Only files inside this folder (at any depth)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  folderId?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 500, description: 'Picked folders: every file inside, at any depth. With documentIds empty too, the whole workspace.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  folderIds?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 500, description: 'Picked single files' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ description: 'Change what an existing workspace mapping covers instead of adding one' })
  @IsOptional()
  @IsUUID()
  mappingId?: string;

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

  @ApiPropertyOptional({ type: () => AiExtractionSettingsDto, description: 'Overrides the admin defaults for how much the AI reads' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiExtractionSettingsDto)
  aiSettings?: AiExtractionSettingsDto;
}

/** A page of one concept's records, optionally narrowed by a search. */
export class ConceptRecordsQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dataRevisionId?: string;
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

export class SaveIdentityRuleDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: [String], maxItems: 10, description: 'Concept fields that together make each record unique; empty clears the rule' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  fields!: string[];
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

export class RebuildPopulationDto {
  @ApiPropertyOptional({ description: 'Also read every document again with AI instead of reusing earlier readings' })
  @IsOptional()
  @IsBoolean()
  forgetDocumentReading?: boolean;
}

export const RECORD_CORRECTION_ACTIONS = ['edit_entity', 'remove_entity', 'add_relationship', 'remove_relationship'] as const;
export type RecordCorrectionAction = (typeof RECORD_CORRECTION_ACTIONS)[number];

export class RecordCorrectionDto {
  @ApiProperty({ enum: RECORD_CORRECTION_ACTIONS })
  @IsIn(RECORD_CORRECTION_ACTIONS as unknown as string[])
  action!: RecordCorrectionAction;

  @ApiProperty({ description: 'Record ({ entityId }) or link ({ relationId, sourceEntityId, targetEntityId })' })
  @IsDefined()
  @IsObject()
  targetIdentity!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'For a value fix: { attribute, value }' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CanvasPositionDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  id!: string;

  @ApiProperty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-1_000_000)
  @Max(1_000_000)
  x!: number;

  @ApiProperty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-1_000_000)
  @Max(1_000_000)
  y!: number;
}

export class SaveCanvasPositionsDto {
  @ApiProperty({ type: [CanvasPositionDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CanvasPositionDto)
  positions!: CanvasPositionDto[];
}
