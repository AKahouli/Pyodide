import { IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class RerunStepDto {
  @IsString()
  taskId!: string;

  @IsOptional()
  @IsBoolean()
  runEvaluation?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['live', 'replay_strict', 'replay_flex', 'replay_adaptive'])
  executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';

  @IsOptional()
  @IsBoolean()
  streaming?: boolean;

  @IsOptional()
  @IsBoolean()
  runNodeReflection?: boolean;

  @IsOptional()
  @IsBoolean()
  advisorAutopilotEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  advisorAutopilotTargetScore?: number;

  @IsOptional()
  @IsNumber()
  advisorAutopilotMaxTurns?: number;
}
