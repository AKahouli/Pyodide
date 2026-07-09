import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];
}
