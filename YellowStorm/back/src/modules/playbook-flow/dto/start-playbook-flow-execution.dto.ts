import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class StartPlaybookFlowExecutionDto {
  @ApiPropertyOptional({ description: 'Optional single node id for standalone step execution' })
  @IsOptional()
  @IsString()
  singleStepTaskId?: string;

  @ApiPropertyOptional({ description: 'Optional execution input context object' })
  @IsOptional()
  @IsObject()
  inputContext?: Record<string, unknown>;
}
