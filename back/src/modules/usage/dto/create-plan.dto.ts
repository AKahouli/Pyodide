import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
  Min,
  Matches,
  IsObject,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ description: 'Plan name', example: 'Pro' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'Plan slug (lowercase, no spaces)', example: 'pro' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with hyphens only' })
  slug!: string;

  @ApiPropertyOptional({ description: 'Plan description', example: 'Professional plan for power users' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Token limit per window (-1 for unlimited)', example: 100000 })
  @IsNumber()
  @Min(-1)
  tokenLimit!: number;

  @ApiProperty({ description: 'Window duration in hours', example: 24 })
  @IsNumber()
  @Min(1)
  windowHours!: number;

  @ApiPropertyOptional({ description: 'Requests per minute limit (-1 for unlimited)', example: 60 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  requestsPerMinute?: number;

  @ApiPropertyOptional({ description: 'Max tokens per request (-1 for unlimited)', example: 4000 })
  @IsNumber()
  @IsOptional()
  @Min(-1)
  maxTokensPerRequest?: number;

  @ApiPropertyOptional({ description: 'Feature flags', example: ['basic_chat', 'history'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @ApiProperty({ description: 'Plan priority (higher = better tier)', example: 1 })
  @IsNumber()
  @Min(0)
  priority!: number;

  @ApiPropertyOptional({ description: 'Monthly price', example: 9.99 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({ description: 'Yearly price', example: 99.99 })
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

  @ApiPropertyOptional({ description: 'Display order', example: 1 })
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
