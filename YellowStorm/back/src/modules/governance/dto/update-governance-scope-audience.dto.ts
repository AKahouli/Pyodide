import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { GovernanceScopeAudienceMode } from '../domain/governance-scope-audience';

export class UpdateGovernanceScopeAudienceDto {
  @ApiProperty({ enum: ['all_authenticated', 'restricted'] })
  @IsIn(['all_authenticated', 'restricted'])
  mode!: GovernanceScopeAudienceMode;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  groupIds?: string[];
}
