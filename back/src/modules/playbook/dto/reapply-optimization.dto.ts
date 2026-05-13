import { IsIn, IsInt, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReapplyOptimizationDto {
  @ApiProperty({ description: 'Index into the task advisorOptimizationHistory array' })
  @IsInt()
  @IsNumber()
  @Min(0)
  historyIndex!: number;

  @ApiProperty({ description: 'Apply the after (optimized) or before (original) snapshot', enum: ['after', 'before'] })
  @IsIn(['after', 'before'])
  direction!: 'after' | 'before';
}
