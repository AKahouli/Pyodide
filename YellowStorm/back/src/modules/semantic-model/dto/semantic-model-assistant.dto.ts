import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const CARDINALITIES = ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'] as const;

export class AssistantFieldDto {
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) key?: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @ApiPropertyOptional({ enum: ['text', 'number', 'boolean', 'date', 'enum'] }) @IsOptional() @IsIn(['text', 'number', 'boolean', 'date', 'enum']) type?: 'text' | 'number' | 'boolean' | 'date' | 'enum';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) options?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) aliases?: string[];
}

export class AssistantConceptDto {
  @ApiPropertyOptional({ description: 'An existing concept (key or name) to change' }) @IsOptional() @IsString() @MaxLength(160) concept?: string;
  @ApiPropertyOptional({ maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160) label?: string;
  @ApiPropertyOptional({ maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160) newLabel?: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: ['business_object', 'classification'] }) @IsOptional() @IsIn(['business_object', 'classification']) category?: 'business_object' | 'classification';
  @ApiPropertyOptional({ enum: ['none', 'optional', 'expected'] }) @IsOptional() @IsIn(['none', 'optional', 'expected']) recordPolicy?: 'none' | 'optional' | 'expected';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) aliases?: string[];
  @ApiPropertyOptional({ type: [AssistantFieldDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AssistantFieldDto) fields?: AssistantFieldDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) removeFields?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) keyFields?: string[];
}

export class AssistantRelationDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) from!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) to!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) label!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) key?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) inverseLabel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: CARDINALITIES }) @IsOptional() @IsIn(CARDINALITIES) cardinality?: (typeof CARDINALITIES)[number];
}

export class AssistantRelationRefDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) from!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) label?: string;
}

export class AssistantModelChangesDto {
  @ApiPropertyOptional({ type: [AssistantConceptDto] }) @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => AssistantConceptDto) concepts?: AssistantConceptDto[];
  @ApiPropertyOptional({ type: [AssistantRelationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AssistantRelationDto) relations?: AssistantRelationDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) removeConcepts?: string[];
  @ApiPropertyOptional({ type: [AssistantRelationRefDto] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AssistantRelationRefDto) removeRelations?: AssistantRelationRefDto[];
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class AssistantCreateModelDto {
  @ApiProperty({ maxLength: 160 }) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class AssistantListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) folderId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}

export class AssistantProfileDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) workspaceId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) documentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sheetName?: string;
}

export class AssistantMapSpreadsheetDto extends AssistantProfileDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) concept!: string;
  @ApiProperty({ description: 'Concept field (key or name) -> column name' }) @IsObject() columns!: Record<string, string>;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) keyFields?: string[];
}

export class AssistantMapDocumentsDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) concept!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) workspaceId!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) documentIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) folderIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wholeWorkspace?: boolean;
  @ApiPropertyOptional({ description: 'Concept field -> "ai" | "extract" | "document_name" | "ignore" | {"constant": "..."}' }) @IsOptional() @IsObject() fields?: Record<string, 'ai' | 'extract' | 'document_name' | 'ignore' | { constant: string }>;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) keyFields?: string[];
}

export class AssistantRecordsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class AssistantChangesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) since?: string;
}

export class AssistantSuggestionOptionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) workspaceId!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) folderIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) documentIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sheetName?: string;
  @ApiPropertyOptional({ description: 'Why this source fits the concept, in a few words' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class AssistantSourceSuggestionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) concept!: string;
  @ApiPropertyOptional({ type: [AssistantSuggestionOptionDto], description: 'Empty: the person chooses the files from the list of their workspaces' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => AssistantSuggestionOptionDto) options?: AssistantSuggestionOptionDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AssistantSuggestSourcesDto {
  @ApiProperty({ type: [AssistantSourceSuggestionDto] }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AssistantSourceSuggestionDto) suggestions!: AssistantSourceSuggestionDto[];
}

export class SourceSuggestionStatusDto {
  @ApiProperty({ enum: ['pending', 'skipped'] }) @IsIn(['pending', 'skipped']) status!: 'pending' | 'skipped';
}
