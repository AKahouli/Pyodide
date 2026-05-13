import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum GroupByPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Start date for analytics query (ISO string)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'End date for analytics query (ISO string)',
    example: '2024-01-31T23:59:59Z',
  })
  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Group time-series data by period',
    enum: GroupByPeriod,
    example: 'day',
  })
  @IsEnum(GroupByPeriod)
  @IsOptional()
  groupBy?: GroupByPeriod;
}
