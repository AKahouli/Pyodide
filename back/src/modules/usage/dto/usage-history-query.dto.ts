import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UsageHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Start date (ISO string)', example: '2024-01-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO string)', example: '2024-01-31T23:59:59Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Number of records to return', example: 30, default: 30 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  @ApiPropertyOptional({ description: 'Number of records to skip', example: 0, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0)
  skip?: number = 0;
}
