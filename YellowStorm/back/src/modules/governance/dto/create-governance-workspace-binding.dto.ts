import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsMongoId, IsObject, IsOptional } from 'class-validator';
export class CreateGovernanceWorkspaceBindingDto {
  @ApiProperty() @IsMongoId() workspaceId!: string;
  @ApiProperty({ enum: ['program_shared', 'scope_specific', 'multi_scope'] }) @IsIn(['program_shared', 'scope_specific', 'multi_scope']) visibility!: 'program_shared' | 'scope_specific' | 'multi_scope';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsMongoId({ each: true }) scopeIds?: string[];
  @ApiPropertyOptional({ enum: ['manual', 'assisted', 'automatic'] }) @IsOptional() @IsIn(['manual', 'assisted', 'automatic']) ingestionMode?: 'manual' | 'assisted' | 'automatic';
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() defaults?: Record<string, unknown>;
}
export class UpdateGovernanceWorkspaceBindingDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['manual', 'assisted', 'automatic'] }) @IsOptional() @IsIn(['manual', 'assisted', 'automatic']) ingestionMode?: 'manual' | 'assisted' | 'automatic';
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() defaults?: Record<string, unknown>;
}
