import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { FlowReplayValidationMode } from '../schemas/playbook-flow-validated-replay.schema';
import { FlowReplayConfigDto } from './flow-replay-config.dto';

const VALIDATE_REPLAY_MODES = [
  FlowReplayValidationMode.STRICT,
  FlowReplayValidationMode.FLEX,
  FlowReplayValidationMode.ADAPTIVE,
  FlowReplayValidationMode.LEGACY_STRICT,
] as const;

export class ValidateTaskReplayDto {
  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  iteration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preserveOutputFormat?: boolean;

  @ApiPropertyOptional({ enum: VALIDATE_REPLAY_MODES })
  @IsOptional()
  @IsIn(VALIDATE_REPLAY_MODES)
  mode?: FlowReplayValidationMode;

  @ApiPropertyOptional({ type: () => FlowReplayConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowReplayConfigDto)
  replayConfig?: FlowReplayConfigDto;
}
