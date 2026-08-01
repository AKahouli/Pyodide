import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateDocumentValidityDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedGovernanceRevision!: number;
  @ApiPropertyOptional({ enum: ['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown'] }) @IsOptional() @IsIn(['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown']) mode?: string;
  @ApiPropertyOptional({ enum: ['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended'] }) @IsOptional() @IsIn(['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended']) businessStatus?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_object, value) => value !== null) @IsDateString() effectiveFrom?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_object, value) => value !== null) @IsDateString() effectiveUntil?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inclusiveEnd?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_object, value) => value !== null) @IsDateString() lastReviewedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_object, value) => value !== null) @IsDateString() nextReviewAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_object, value) => value !== null) @IsNumber() @Min(1) reviewFrequencyDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() manuallyOverridden?: boolean;
}
