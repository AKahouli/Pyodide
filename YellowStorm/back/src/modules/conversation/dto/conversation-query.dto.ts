import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationQueryDto {
  @ApiPropertyOptional({ enum: ['legacy', 'cursor'], default: 'legacy' })
  @IsOptional()
  @IsIn(['legacy', 'cursor'])
  mode?: 'legacy' | 'cursor';

  @ApiPropertyOptional({ description: 'Opaque cursor returned by a previous cursor-mode request' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: ['chat', 'platform_copilot'], description: 'Filter by conversation runtime purpose' })
  @IsOptional()
  @IsIn(['chat', 'platform_copilot'])
  runtimePurpose?: 'chat' | 'platform_copilot';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['lastMessageAt', 'createdAt', 'title'], default: 'lastMessageAt' })
  @IsOptional()
  @IsIn(['lastMessageAt', 'createdAt', 'title'])
  sortBy?: 'lastMessageAt' | 'createdAt' | 'title' = 'lastMessageAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Filter by archived status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({ description: 'Filter by project ID, or "none" for conversations not in any project' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ enum: ['title', 'fulltext'], description: 'Where to look when search is provided' })
  @IsOptional()
  @IsIn(['title', 'fulltext'])
  searchScope?: 'title' | 'fulltext';
}
