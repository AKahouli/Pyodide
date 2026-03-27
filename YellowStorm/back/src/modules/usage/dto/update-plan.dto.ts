import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
  Min,
  IsObject,
} from 'class-validator';

export class UpdatePlanDto {
  @ApiPropertyOptional({ description: 'Plan name', example: 'Pro Plus' })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Plan description', example: 'Enhanced professional plan' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Token limit per window (-1 for unlimited)', example: 200000 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  tokenLimit?: number;

  @ApiPropertyOptional({ description: 'Window duration in hours', example: 24 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  windowHours?: number;

  @ApiPropertyOptional({ description: 'Requests per minute limit (-1 for unlimited)', example: 120 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  requestsPerMinute?: number;

  @ApiPropertyOptional({ description: 'Max tokens per request (-1 for unlimited)', example: 8000 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  maxTokensPerRequest?: number;

  @ApiPropertyOptional({ description: 'Feature flags', example: ['basic_chat', 'history', 'api_access'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @ApiPropertyOptional({ description: 'Plan priority (higher = better tier)', example: 2 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: 'Monthly price', example: 19.99 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({ description: 'Yearly price', example: 199.99 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'USD' })
  @IsString()
  @IsOptional()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Whether plan is active', example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is the default plan', example: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Display order', example: 2 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ description: 'Maximum workspaces allowed (-1 for unlimited)', example: 10 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  maxWorkspaces?: number;

  @ApiPropertyOptional({ description: 'Storage per workspace in bytes', example: 104857600 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  workspaceStorageBytes?: number;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
