import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class SourceValidityEvidenceDto {
  @ApiProperty() @IsString() id!: string;
  @ApiProperty({ enum: ['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode'] }) @IsIn(['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode']) field!: string;
  @ApiProperty({ enum: ['manual', 'technical_metadata', 'document_metadata'] }) @IsIn(['manual', 'technical_metadata', 'document_metadata']) origin!: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(1) confidence!: number;
  @ApiPropertyOptional() @IsOptional() value?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() blockId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() excerpt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validatedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validatedAt?: string;
}

export class UpdateSourceValidityDto {
  @ApiProperty({ enum: ['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown'] })
  @IsIn(['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown']) mode!: string;
  @ApiProperty({ enum: ['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended'] })
  @IsIn(['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended']) businessStatus!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() effectiveUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() manuallyOverridden?: boolean;
  @ApiPropertyOptional({ type: [SourceValidityEvidenceDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SourceValidityEvidenceDto) evidence?: SourceValidityEvidenceDto[];
}
