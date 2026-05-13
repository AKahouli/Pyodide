import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsEnum,
  Min,
  MaxLength,
  IsObject,
  IsMongoId,
} from 'class-validator';
import { UsageType } from '../schemas/usage.schema';

export class RecordUsageDto {
  @ApiProperty({ description: 'Number of input tokens', example: 150 })
  @IsNumber()
  @Min(0)
  inputTokens!: number;

  @ApiProperty({ description: 'Number of output tokens', example: 200 })
  @IsNumber()
  @Min(0)
  outputTokens!: number;

  @ApiPropertyOptional({ description: 'Usage type', enum: UsageType, example: UsageType.CHAT })
  @IsEnum(UsageType)
  @IsOptional()
  usageType?: UsageType;

  @ApiPropertyOptional({ description: 'Model used', example: 'gpt-4' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  modelName?: string;

  @ApiPropertyOptional({ description: 'Conversation ID' })
  @IsMongoId()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Endpoint or action identifier', example: '/chat/completions' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  endpoint?: string;

  @ApiPropertyOptional({ description: 'Request duration in milliseconds', example: 1500 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  durationMs?: number;

  @ApiPropertyOptional({ description: 'Whether request was successful', example: true })
  @IsBoolean()
  @IsOptional()
  success?: boolean;

  @ApiPropertyOptional({ description: 'Error code if request failed', example: 'CONTEXT_LENGTH_EXCEEDED' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  errorCode?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
