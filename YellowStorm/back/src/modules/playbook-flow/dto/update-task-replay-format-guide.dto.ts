import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { FlowReplayConfigDto } from './flow-replay-config.dto';

export class UpdateTaskReplayFormatGuideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preserveOutputFormat?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputFormatGuide?: string;

  @ApiPropertyOptional({ type: () => FlowReplayConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowReplayConfigDto)
  replayConfig?: FlowReplayConfigDto;
}
