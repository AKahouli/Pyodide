import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class FlowReplayConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  replayOutputFormat?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  replayToolTrace?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  replayReasoningChain?: boolean;
}
