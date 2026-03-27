import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AuditLogStatus } from '../interfaces/audit-log.interface';

export class AuditLogQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by actor user ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Search by actor email (partial match)',
    example: 'admin@example.com',
  })
  @IsOptional()
  @IsString()
  actorEmail?: string;

  @ApiPropertyOptional({
    description: 'Filter by action (exact match or prefix with *)',
    example: 'users.suspend',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'Filter by action feature/namespace (e.g., "users", "roles")',
    example: 'users',
  })
  @IsOptional()
  @IsString()
  feature?: string;

  @ApiPropertyOptional({
    description: 'Filter by target type',
    example: 'User',
  })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['success', 'failure'],
  })
  @IsOptional()
  @IsEnum(['success', 'failure'])
  status?: AuditLogStatus;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO 8601)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO 8601)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Number of results to skip',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number = 0;
}
