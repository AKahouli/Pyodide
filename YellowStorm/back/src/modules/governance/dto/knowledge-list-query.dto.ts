import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';

export class KnowledgeListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() scopeId?: string;
  @ApiPropertyOptional({ enum: ['open', 'acknowledged', 'resolved', 'ignored', 'proposed', 'accepted', 'rejected', 'applied', 'superseded'] }) @IsOptional() @IsIn(['open', 'acknowledged', 'resolved', 'ignored', 'proposed', 'accepted', 'rejected', 'applied', 'superseded']) status?: string;
  @ApiPropertyOptional({ enum: ['validity', 'freshness', 'availability', 'integrity', 'governance', 'search_quality', 'impact'] }) @IsOptional() @IsIn(['validity', 'freshness', 'availability', 'integrity', 'governance', 'search_quality', 'impact']) category?: string;
  @ApiPropertyOptional({ enum: ['critical', 'high', 'medium', 'low'] }) @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) severity?: string;
  @ApiPropertyOptional({ enum: ['critical', 'high', 'medium', 'low'] }) @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
}
