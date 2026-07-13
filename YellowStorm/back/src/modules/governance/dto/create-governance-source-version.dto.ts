import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateGovernanceSourceVersionDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() workspaceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) canonicalUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) contentHash?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() extractedMetadata?: Record<string, unknown>;
}
