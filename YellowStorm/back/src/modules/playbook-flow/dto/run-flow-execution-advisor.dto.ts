import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class RunFlowExecutionAdvisorDto {
  @ApiPropertyOptional({ description: 'Specific task iteration to evaluate', minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  iteration?: number;
}
