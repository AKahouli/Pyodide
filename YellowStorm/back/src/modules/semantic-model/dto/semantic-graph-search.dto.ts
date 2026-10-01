import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  @ApiPropertyOptional({ default: 10, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
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
  @ApiPropertyOptional({ default: 10, maximum: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25) limit?: number;
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
