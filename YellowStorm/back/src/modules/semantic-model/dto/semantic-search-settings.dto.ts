import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Admin graph search settings (Admin > Semantic models). Every value is optional: one left out uses the
 * built-in value. Bounds here; how the values fit together (min < target < max…) is checked by the service.
 */
export class SearchIndexSettingsDto {
  @ApiPropertyOptional({ minimum: 100, maximum: 2000, default: 300, description: 'Most characters of one field value on a record\'s search card' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(2000)
  cardValueChars?: number;

  @ApiPropertyOptional({ minimum: 500, maximum: 10000, default: 2000, description: 'Most characters of a whole search card' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(500) @Max(10000)
  cardTextChars?: number;

  @ApiPropertyOptional({ minimum: 50, maximum: 2000, description: 'A field longer than this is also split into passages; the card value cap when absent' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(2000)
  longFieldChars?: number;

  @ApiPropertyOptional({ minimum: 200, maximum: 4000, default: 1000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(200) @Max(4000)
  passageTargetChars?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 4000, default: 700 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(4000)
  passageMinChars?: number;

  @ApiPropertyOptional({ minimum: 200, maximum: 6000, default: 1200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(200) @Max(6000)
  passageMaxChars?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, default: 150, description: 'Characters two consecutive passages share' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000)
  passageOverlapChars?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  maxPassagesPerField?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxPassagesPerRecord?: number;

  @ApiPropertyOptional({ default: true, description: 'Name the concept, record and field above each passage' })
  @IsOptional() @IsBoolean()
  passageHeader?: boolean;
}

export class SearchQuerySettingsDto {
  @ApiPropertyOptional({ minimum: 5, maximum: 500, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(500)
  lexicalCandidates?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 500, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(500)
  vectorCandidates?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.4, description: 'Floor for records near a request only by meaning' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  minSimilarity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 60, description: 'Reciprocal rank fusion constant' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  rrfK?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  defaultLimit?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  maxLimit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, default: 2 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10)
  passagesPerRecord?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 4000, default: 400 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(4000)
  excerptChars?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 4000, default: 400 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(4000)
  snippetChars?: number;

  @ApiPropertyOptional({ default: true, description: 'Leave common words (de, la, the, of…) out of word matching' })
  @IsOptional() @IsBoolean()
  stopWords?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(40, { each: true })
  extraStopWords?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 64, default: 16 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(64)
  maxQueryTerms?: number;
}
