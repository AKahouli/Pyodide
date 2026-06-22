import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalCostEventDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ enum: ['llm', 'tool', 'embedding'] })
  @IsIn(['llm', 'tool', 'embedding'])
  type!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inputTokens?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  outputTokens?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskId?: string;
}
