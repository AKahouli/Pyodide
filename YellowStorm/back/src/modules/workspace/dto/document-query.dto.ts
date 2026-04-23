import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus } from '../schemas/workspace-document.schema';

export class DocumentQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by document status', enum: DocumentStatus })
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @ApiPropertyOptional({ description: 'Search by filename' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['originalName', 'createdAt', 'size'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['originalName', 'createdAt', 'size'])
  sortBy?: 'originalName' | 'createdAt' | 'size' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Filter by parent folder ID (null for root)' })
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
