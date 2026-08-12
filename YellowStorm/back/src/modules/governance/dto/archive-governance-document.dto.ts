import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ArchiveGovernanceDocumentDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedGovernanceRevision!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
