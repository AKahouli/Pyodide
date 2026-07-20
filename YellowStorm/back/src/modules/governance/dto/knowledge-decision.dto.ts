import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsOptional, IsString, MaxLength } from 'class-validator';

export class KnowledgeDecisionDto {
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class MetadataCandidateDecisionDto extends KnowledgeDecisionDto {
  @ApiPropertyOptional({ description: 'Optional corrected value to accept instead of the proposed value' }) @IsOptional() @Allow() acceptedValue?: unknown;
}
