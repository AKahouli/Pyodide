import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class SourceValidityEvidenceDto {
  @ApiProperty() @IsString() id!: string;
  @ApiProperty({ enum: ['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode'] }) @IsIn(['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode']) field!: string;
  @ApiProperty({ enum: ['manual', 'technical_metadata', 'http_header', 'html_metadata', 'structured_data', 'document_metadata', 'logical_search', 'llm_extraction', 'policy'] }) @IsIn(['manual', 'technical_metadata', 'http_header', 'html_metadata', 'structured_data', 'document_metadata', 'logical_search', 'llm_extraction', 'policy']) origin!: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(1) confidence!: number;
  @ApiPropertyOptional() @IsOptional() value?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() excerpt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validatedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validatedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() extractionMethod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() capturedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCritical?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() supersedesEvidenceId?: string;
}

export class UpdateSourceValidityDto {
  @ApiPropertyOptional({ enum: ['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown'] })
  @IsOptional() @IsIn(['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown']) mode?: string;
  @ApiPropertyOptional({ enum: ['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended'] })
  @IsOptional() @IsIn(['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended']) businessStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inclusiveEnd?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() lastReviewedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextReviewAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) reviewFrequencyDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() manuallyOverridden?: boolean;
  @ApiPropertyOptional({ type: [SourceValidityEvidenceDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SourceValidityEvidenceDto) evidence?: SourceValidityEvidenceDto[];
}
