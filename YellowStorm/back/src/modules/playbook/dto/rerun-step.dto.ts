import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

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
}
