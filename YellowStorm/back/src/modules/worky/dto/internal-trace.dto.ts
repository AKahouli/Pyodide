import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalTraceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiProperty({ enum: ['tool', 'model'] })
  @IsIn(['tool', 'model'])
  kind!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: 'Admin-only URI to the raw payload' })
  @IsOptional()
  @IsString()
  rawPayloadUri?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  durationMs?: number;
}
