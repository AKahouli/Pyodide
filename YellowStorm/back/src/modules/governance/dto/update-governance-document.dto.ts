import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsMongoId, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateGovernanceDocumentDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedGovernanceRevision!: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(100, { each: true }) tags?: string[];
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() ownerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() ownerScopeId?: string;
}
