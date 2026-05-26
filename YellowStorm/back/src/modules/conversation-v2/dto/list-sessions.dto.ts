import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListSessionsDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'ISO timestamp cursor — older than this' })
  @IsOptional() @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Title substring (case-insensitive)' })
  @IsOptional() @IsString()
  q?: string;
}
