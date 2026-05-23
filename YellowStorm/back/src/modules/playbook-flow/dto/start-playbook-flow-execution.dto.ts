import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { ADVISOR_SCORING_MODES, type AdvisorScoringMode } from '../schemas/playbook-flow.schema';

const EXECUTION_MODES = ['live', 'inherit', 'replay_strict', 'replay_flex', 'replay_adaptive'] as const;

export class StartPlaybookFlowExecutionDto {
  @ApiPropertyOptional({ description: 'Optional single node id for targeted step execution' })
  @IsOptional()
  @IsString()
  singleStepTaskId?: string;

  @ApiPropertyOptional({ description: 'Optional execution input context object' })
  @IsOptional()
  @IsObject()
  inputContext?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Execution mode', enum: EXECUTION_MODES, default: 'live' })
  @IsOptional()
  @IsIn(EXECUTION_MODES)
  executionMode?: string;

  @ApiPropertyOptional({ description: 'Per-task execution modes (taskId -> mode)' })
  @IsOptional()
  @IsObject()
  stepExecutionModes?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Enable advisor autopilot mode for automatic advisor evaluation on task completion' })
  @IsOptional()
  @IsBoolean()
  advisorAutopilotEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Target score for autopilot advisor' })
  @IsOptional()
  @IsNumber()
  advisorAutopilotTargetScore?: number;

  @ApiPropertyOptional({ description: 'Max autopilot turns' })
  @IsOptional()
  @IsNumber()
  advisorAutopilotMaxTurns?: number;

  @ApiPropertyOptional({ description: 'Enable advisor reflection mode (auto-evaluate on step completion)' })
  @IsOptional()
  @IsBoolean()
  reflectionEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Advisor scoring mode', enum: ADVISOR_SCORING_MODES, default: 'llm' })
  @IsOptional()
  @IsIn(ADVISOR_SCORING_MODES)
  advisorScoringMode?: AdvisorScoringMode;
}
