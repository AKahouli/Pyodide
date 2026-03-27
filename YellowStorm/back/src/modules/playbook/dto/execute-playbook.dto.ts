import { IsIn, IsOptional, IsString, IsObject, IsBoolean, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExecutePlaybookDto {
  @ApiPropertyOptional({ description: 'Run only this task (null = run all)' })
  @IsOptional()
  @IsString()
  singleStepTaskId?: string;

  @ApiPropertyOptional({ description: 'Overall query/context for the execution' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  query?: string;

  @ApiPropertyOptional({ description: 'Global execution mode (live or inherit for full-workflow)' })
  @IsOptional()
  @IsString()
  @IsIn(['live', 'inherit'])
  executionMode?: 'live' | 'inherit';

  @ApiPropertyOptional({ description: 'Per-step execution mode overrides (taskId -> mode)' })
  @IsOptional()
  @IsObject()
  stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;

  @ApiPropertyOptional({ description: 'Run semantic evaluation against baseline replay for completed steps' })
  @IsOptional()
  @IsBoolean()
  runEvaluation?: boolean;
}
