import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGovernanceDocumentDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(100, { each: true }) tags?: string[];
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() ownerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() ownerScopeId?: string;
}
