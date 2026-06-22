import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_TASK_LANES } from '../constants/worky.constants';

export class MoveWorkyTaskDto {
  @ApiProperty({ enum: WORKY_TASK_LANES })
  @IsIn(WORKY_TASK_LANES as unknown as string[])
  lane!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class WorkyTaskControlDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
