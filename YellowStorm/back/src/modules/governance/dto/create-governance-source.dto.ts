import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsObject, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';

export class CreateGovernanceSourceDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  scopeIds?: string[];

  @ApiProperty({ enum: ['program_shared', 'scope_specific', 'multi_scope'] })
  @IsIn(['program_shared', 'scope_specific', 'multi_scope'])
  visibility!: 'program_shared' | 'scope_specific' | 'multi_scope';

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @ApiProperty({ enum: ['pdf', 'web_page', 'api', 'manual_record', 'spreadsheet'] })
  @IsIn(['pdf', 'web_page', 'api', 'manual_record', 'spreadsheet'])
  sourceType!: 'pdf' | 'web_page' | 'api' | 'manual_record' | 'spreadsheet';

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  documentId?: string;

  @ApiPropertyOptional({ enum: ['draft', 'to_review', 'validated', 'published', 'expired', 'rejected'] })
  @IsOptional()
  @IsIn(['draft', 'to_review', 'validated', 'published', 'expired', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Min(1)
  reviewFrequencyDays?: number;
}
