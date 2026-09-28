import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ADVISOR_SCORING_MODES, type AdvisorScoringMode } from '../models/playbook-flow.model';

export class RunFlowExecutionAdvisorDto {
  @ApiPropertyOptional({ description: 'Specific task iteration to evaluate', minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  iteration?: number;

  @ApiPropertyOptional({ description: 'Optional scoring mode override for this run', enum: ADVISOR_SCORING_MODES })
  @IsOptional()
  @IsIn(ADVISOR_SCORING_MODES)
  advisorScoringMode?: AdvisorScoringMode;
}
