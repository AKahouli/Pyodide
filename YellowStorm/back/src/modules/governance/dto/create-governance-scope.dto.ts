import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsMongoId, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class GovernanceScopeKnowledgeDto {
  @ApiPropertyOptional({ enum: ['llm_only', 'workspaces_only'] })
  @IsOptional()
  @IsIn(['llm_only', 'workspaces_only'])
  sourceMode?: 'llm_only' | 'workspaces_only';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  webSourcesEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  webAllowedDomains?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  webBlockedDomains?: string[];
}

export class CreateGovernanceScopeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  parentScopeId?: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ enum: ['organization', 'municipality', 'department', 'business_unit', 'country', 'team', 'custom'] })
  @IsOptional()
  @IsIn(['organization', 'municipality', 'department', 'business_unit', 'country', 'team', 'custom'])
  type?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /**
   * Knowledge source policy. Replaces the whole knowledge object on update:
   * absent fields fall back to their defaults (sourceMode llm_only, web
   * sources disabled, empty domain lists).
   */
  @ApiPropertyOptional({ type: GovernanceScopeKnowledgeDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GovernanceScopeKnowledgeDto)
  knowledge?: GovernanceScopeKnowledgeDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];
}
