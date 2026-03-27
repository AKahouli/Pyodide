import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PlaybookQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['updatedAt', 'createdAt', 'name', 'taskCount', 'lastExecutionAt'], default: 'updatedAt' })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'name', 'taskCount', 'lastExecutionAt'])
  sortBy?: 'updatedAt' | 'createdAt' | 'name' | 'taskCount' | 'lastExecutionAt' = 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Minimum number of tasks' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minTasks?: number;

  @ApiPropertyOptional({ description: 'Maximum number of tasks' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxTasks?: number;

  @ApiPropertyOptional({ description: 'Filter by date field', enum: ['createdAt', 'updatedAt', 'lastExecutionAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'lastExecutionAt'])
  dateField?: 'createdAt' | 'updatedAt' | 'lastExecutionAt';

  @ApiPropertyOptional({ description: 'Date range start (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Date range end (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
