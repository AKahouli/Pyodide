import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_STREAM_STATUSES } from '../constants/worky.constants';

export const WORKY_STREAM_SORT_FIELDS = ['lastActivity', 'created', 'title'] as const;
export type WorkyStreamSortField = (typeof WORKY_STREAM_SORT_FIELDS)[number];

export const WORKY_STREAM_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type WorkyStreamSortDirection = (typeof WORKY_STREAM_SORT_DIRECTIONS)[number];

export class QueryWorkyStreamsDto {
  @ApiPropertyOptional({ description: 'Free-text search by stream title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1, description: '1-based page number' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 12, description: 'Page size' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 12;

  @ApiPropertyOptional({
    isArray: true,
    enum: WORKY_STREAM_STATUSES,
    description: 'Filter by one or more stream statuses',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsIn(WORKY_STREAM_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ description: 'Streams waiting for input or containing blocked or failed tasks' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  attention?: boolean;

  @ApiPropertyOptional({ enum: WORKY_STREAM_SORT_FIELDS, default: 'lastActivity' })
  @IsOptional()
  @IsIn(WORKY_STREAM_SORT_FIELDS)
  sort?: WorkyStreamSortField;

  @ApiPropertyOptional({ enum: WORKY_STREAM_SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(WORKY_STREAM_SORT_DIRECTIONS)
  sortDir?: WorkyStreamSortDirection;

  @ApiPropertyOptional({ description: 'Filter: created at or after this ISO date' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Filter: created at or before this ISO date' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
