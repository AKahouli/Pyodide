import { IsOptional, IsInt, Min, Max, IsIn, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MessageQueryDto {
  @ApiPropertyOptional({ enum: ['legacy', 'cursor'], default: 'legacy' })
  @IsOptional()
  @IsIn(['legacy', 'cursor'])
  mode?: 'legacy' | 'cursor';

  @ApiPropertyOptional({ description: 'Opaque cursor returned by a previous cursor-mode request' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: ['user', 'ai'] })
  @IsOptional()
  @IsIn(['user', 'ai'])
  conversationType?: 'user' | 'ai';
}

export class MessageSearchDto {
  @IsString()
  @Length(1, 200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 20;
}

export class MessageAroundDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
