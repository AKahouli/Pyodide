import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class StartPlaybookFlowExecutionDto {
  @ApiPropertyOptional({ description: 'Optional single node id for targeted step execution' })
  @IsOptional()
  @IsString()
  singleStepTaskId?: string;

  @ApiPropertyOptional({ description: 'Optional execution input context object' })
  @IsOptional()
  @IsObject()
  inputContext?: Record<string, unknown>;

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
}
