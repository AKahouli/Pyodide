import { IsIn, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WorkyBudgetControlDto {
  @ApiProperty({ minimum: 0, description: 'USD limit. 0 = unlimited.' })
  @IsNumber()
  @Min(0)
  limitUsd!: number;

  @ApiProperty({ minimum: 0, description: 'Token limit. 0 = unlimited.' })
  @IsNumber()
  @Min(0)
  limitTokens!: number;

  @ApiProperty({ enum: ['hard_stop', 'notify'] })
  @IsIn(['hard_stop', 'notify'])
  enforcement!: 'hard_stop' | 'notify';
}
