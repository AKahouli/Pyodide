import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const SEARCH_ENVIRONMENTS = ['draft', 'production'] as const;
export type SearchEnvironment = (typeof SEARCH_ENVIRONMENTS)[number];
export const EXPAND_DIRECTIONS = ['outgoing', 'incoming', 'both'] as const;
export type ExpandDirection = (typeof EXPAND_DIRECTIONS)[number];
/** What an assistant reads: the published data (default) or the draft's. */
export const ASSISTANT_DATA = ['published', 'draft'] as const;
export type AssistantData = (typeof ASSISTANT_DATA)[number];

// ── Editor (public) ───────────────────────────────────────────────────────────

export class GraphSearchEnvironmentQueryDto {
  @ApiPropertyOptional({ enum: SEARCH_ENVIRONMENTS, default: 'draft' })
  @IsOptional()
  @IsIn(SEARCH_ENVIRONMENTS)
  environment: SearchEnvironment = 'draft';
}

export class GraphSearchIndexDto extends GraphSearchEnvironmentQueryDto {}

export class GraphSearchDto {
  @ApiPropertyOptional({ enum: SEARCH_ENVIRONMENTS, default: 'draft' })
  @IsOptional()
  @IsIn(SEARCH_ENVIRONMENTS)
  environment: SearchEnvironment = 'draft';

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @ApiPropertyOptional({ type: [String], description: 'Concept ids, keys, labels or aliases' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  concepts?: string[];

  @ApiPropertyOptional({ maximum: 100, description: 'At most the admin maximum (25 built in); the admin default (10 built in) when absent' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  expectedDataRevisionId?: string;
}

export class GraphExpandStepDto {
  @ApiPropertyOptional({ type: [String], description: 'Relation ids or keys; required on the second step' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  relations?: string[];

  @ApiPropertyOptional({ enum: EXPAND_DIRECTIONS, default: 'both' })
  @IsOptional()
  @IsIn(EXPAND_DIRECTIONS)
  direction?: ExpandDirection;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  concepts?: string[];
}

export class GraphExpandDto {
  @ApiPropertyOptional({ enum: SEARCH_ENVIRONMENTS, default: 'draft' })
  @IsOptional()
  @IsIn(SEARCH_ENVIRONMENTS)
  environment: SearchEnvironment = 'draft';

  @ApiProperty({ type: [String], minItems: 1, maxItems: 25 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  seedEntityIds!: string[];

  @ApiProperty({ type: [GraphExpandStepDto], minItems: 1, maxItems: 2 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => GraphExpandStepDto)
  steps!: GraphExpandStepDto[];

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxNodes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  expectedDataRevisionId?: string;
}

// ── Assistant (internal) ──────────────────────────────────────────────────────

export class AssistantFindRecordsDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) @IsString() @MinLength(1) @MaxLength(500) query!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true }) concepts?: string[];
  @ApiPropertyOptional({ enum: ASSISTANT_DATA, default: 'published' }) @IsOptional() @IsIn(ASSISTANT_DATA) data?: AssistantData;
  @ApiPropertyOptional({ maximum: 100, description: 'At most the admin maximum (25 built in); the admin default (10 built in) when absent' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AssistantRelatedRecordsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 25 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(200, { each: true }) recordIds!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(200, { each: true }) relations?: string[];
  @ApiPropertyOptional({ enum: EXPAND_DIRECTIONS, default: 'both' }) @IsOptional() @IsIn(EXPAND_DIRECTIONS) direction?: ExpandDirection;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(200, { each: true }) thenRelations?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true }) concepts?: string[];
  @ApiPropertyOptional({ enum: ASSISTANT_DATA, default: 'published' }) @IsOptional() @IsIn(ASSISTANT_DATA) data?: AssistantData;
  @ApiPropertyOptional({ default: 50, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxRecords?: number;
}

/** How query_records compares, groups and totals; checked in full (names, types, values) by the runtime. */
export const RECORD_FILTER_OPS = ['eq', 'ne', 'contains', 'starts_with', 'ends_with', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty'] as const;
export const RECORD_DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const RECORD_AGGREGATE_OPS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
/** Read a field with another type than the model declares (a date kept in a text field). */
export const RECORD_VALUE_TYPES = ['text', 'number', 'boolean', 'date'] as const;
export const RECORD_MATCH = ['all', 'any'] as const;
export const RECORD_DIRECTIONS = ['asc', 'desc'] as const;

export class AssistantRecordFilterDto {
  @ApiProperty({ description: 'Field key, label or alias; "name" for the record name; "<relation>.<field>" for a linked record' })
  @IsString() @MinLength(1) @MaxLength(300) field!: string;
  @ApiProperty({ enum: RECORD_FILTER_OPS }) @IsIn(RECORD_FILTER_OPS) op!: (typeof RECORD_FILTER_OPS)[number];
  @ApiPropertyOptional({ description: 'A text, number or yes/no; a list for in and between; an ISO date or a relative period (last_3_months...) for dates' })
  @IsOptional() @Allow() value?: unknown;
  @ApiPropertyOptional({ enum: RECORD_VALUE_TYPES }) @IsOptional() @IsIn(RECORD_VALUE_TYPES) as?: (typeof RECORD_VALUE_TYPES)[number];
}

export class AssistantRecordGroupByDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) field!: string;
  @ApiPropertyOptional({ enum: RECORD_DATE_BUCKETS }) @IsOptional() @IsIn(RECORD_DATE_BUCKETS) bucket?: (typeof RECORD_DATE_BUCKETS)[number];
  @ApiPropertyOptional({ enum: RECORD_VALUE_TYPES }) @IsOptional() @IsIn(RECORD_VALUE_TYPES) as?: (typeof RECORD_VALUE_TYPES)[number];
}

export class AssistantRecordAggregateDto {
  @ApiProperty({ enum: RECORD_AGGREGATE_OPS }) @IsIn(RECORD_AGGREGATE_OPS) op!: (typeof RECORD_AGGREGATE_OPS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(300) field?: string;
  @ApiPropertyOptional({ enum: RECORD_VALUE_TYPES }) @IsOptional() @IsIn(RECORD_VALUE_TYPES) as?: (typeof RECORD_VALUE_TYPES)[number];
}

export class AssistantRecordOrderByDto {
  @ApiProperty({ description: 'A field; with groupBy, a grouped field or an aggregate name (count, sum_amount...)' })
  @IsString() @MinLength(1) @MaxLength(300) field!: string;
  @ApiPropertyOptional({ enum: RECORD_DIRECTIONS, default: 'asc' }) @IsOptional() @IsIn(RECORD_DIRECTIONS) direction?: (typeof RECORD_DIRECTIONS)[number];
  @ApiPropertyOptional({ enum: RECORD_VALUE_TYPES }) @IsOptional() @IsIn(RECORD_VALUE_TYPES) as?: (typeof RECORD_VALUE_TYPES)[number];
}

export class AssistantQueryRecordsDto {
  @ApiProperty({ description: 'Concept key, label or alias' }) @IsString() @MinLength(1) @MaxLength(300) concept!: string;
  @ApiPropertyOptional({ type: [AssistantRecordFilterDto], maxItems: 20 })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AssistantRecordFilterDto) filters?: AssistantRecordFilterDto[];
  @ApiPropertyOptional({ enum: RECORD_MATCH, default: 'all' }) @IsOptional() @IsIn(RECORD_MATCH) match?: (typeof RECORD_MATCH)[number];
  @ApiPropertyOptional({ type: [AssistantRecordGroupByDto], maxItems: 2 })
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => AssistantRecordGroupByDto) groupBy?: AssistantRecordGroupByDto[];
  @ApiPropertyOptional({ type: [AssistantRecordAggregateDto], maxItems: 10 })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AssistantRecordAggregateDto) aggregates?: AssistantRecordAggregateDto[];
  @ApiPropertyOptional({ type: [AssistantRecordOrderByDto], maxItems: 3 })
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => AssistantRecordOrderByDto) orderBy?: AssistantRecordOrderByDto[];
  @ApiPropertyOptional({ type: [String], maxItems: 60 }) @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @MaxLength(300, { each: true }) fields?: string[];
  @ApiPropertyOptional({ default: 50, minimum: 0, maximum: 200, description: '0 returns only the total and aggregates' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(200) limit?: number;
  @ApiPropertyOptional({ default: 0, maximum: 100000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset?: number;
  @ApiPropertyOptional({ enum: ASSISTANT_DATA, default: 'published' }) @IsOptional() @IsIn(ASSISTANT_DATA) data?: AssistantData;
}

export class AssistantDescribeDataQueryDto {
  @ApiPropertyOptional({ enum: ASSISTANT_DATA, default: 'published' }) @IsOptional() @IsIn(ASSISTANT_DATA) data?: AssistantData;
}
