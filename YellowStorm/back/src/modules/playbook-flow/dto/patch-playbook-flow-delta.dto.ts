import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ControlEdgeDto } from './playbook-flow-control-edge.dto';
import { DataBindingDto } from './playbook-flow-data-binding.dto';

class PatchPlaybookFlowDeltaFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  designSettings?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reflectionEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['llm', 'heuristic'] })
  @IsOptional()
  @IsString()
  advisorScoringMode?: 'llm' | 'heuristic';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  advisorAutopilotEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  advisorAutopilotTargetScore?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  advisorAutopilotMaxTurns?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  workspaces?: string[];
}

class PatchPlaybookFlowNodePositionUpdateDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsNumber()
  positionX!: number;

  @ApiProperty()
  @IsNumber()
  positionY!: number;
}

class PatchPlaybookFlowDeltaNodesDto {
  @ApiPropertyOptional({ type: [PatchPlaybookFlowNodePositionUpdateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PatchPlaybookFlowNodePositionUpdateDto)
  positionUpdates?: PatchPlaybookFlowNodePositionUpdateDto[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  upserts?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  deleteIds?: string[];
}

class PatchPlaybookFlowDeltaPatchDto {
  @ApiPropertyOptional({ type: PatchPlaybookFlowDeltaFieldsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchPlaybookFlowDeltaFieldsDto)
  fields?: PatchPlaybookFlowDeltaFieldsDto;

  @ApiPropertyOptional({ type: PatchPlaybookFlowDeltaNodesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchPlaybookFlowDeltaNodesDto)
  nodes?: PatchPlaybookFlowDeltaNodesDto;

  // Typed like the full update: with the global pipe's enableImplicitConversion an untyped
  // Record<string, unknown>[] is converted element by element into empty arrays, which the
  // sanitizer then dropped as orphans and the save persisted as an empty graph.
  @ApiPropertyOptional({ type: [ControlEdgeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ControlEdgeDto)
  controlEdges?: ControlEdgeDto[];

  @ApiPropertyOptional({ type: [DataBindingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => DataBindingDto)
  dataBindings?: DataBindingDto[];
}

export class PatchPlaybookFlowDeltaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;

  @ApiProperty()
  @IsNumber()
  expectedDefinitionRevision!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payloadHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  basePayloadHash?: string;

  @ApiPropertyOptional({ description: 'Stable client-side mutation key for suggestion-generated saves.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientMutationId?: string;

  @ApiProperty({ type: PatchPlaybookFlowDeltaPatchDto })
  @ValidateNested()
  @Type(() => PatchPlaybookFlowDeltaPatchDto)
  patch!: PatchPlaybookFlowDeltaPatchDto;
}
