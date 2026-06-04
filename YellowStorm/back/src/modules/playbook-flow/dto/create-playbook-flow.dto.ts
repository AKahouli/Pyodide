import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, MinLength, MaxLength, IsOptional, IsArray, IsEnum,
  ValidateNested, ArrayMaxSize, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FlowNodeDto } from './playbook-flow-node.dto';
import { ControlEdgeDto } from './playbook-flow-control-edge.dto';
import { DataBindingDto } from './playbook-flow-data-binding.dto';
import { FlowTriggerConfigDto, FlowSettingsDto } from './playbook-flow-node.dto';
import { NODE_KINDS } from '../constants/node-kinds';
import { ADVISOR_SCORING_MODES, type AdvisorScoringMode } from '../schemas/playbook-flow.schema';

export class CreatePlaybookFlowDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowTriggerConfigDto)
  triggerConfig?: FlowTriggerConfigDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowSettingsDto)
  settings?: FlowSettingsDto;

  @ApiPropertyOptional({ description: 'Smart HITL policy for the workflow.' })
  @IsOptional()
  @IsObject()
  hitlPolicy?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object], description: 'Workflow-level blocker rules for Smart HITL.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  hitlBlockers?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ type: [FlowNodeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FlowNodeDto)
  nodes?: FlowNodeDto[];

  @ApiPropertyOptional({ type: [ControlEdgeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ControlEdgeDto)
  controlEdges?: ControlEdgeDto[];

  @ApiPropertyOptional({ type: [DataBindingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DataBindingDto)
  dataBindings?: DataBindingDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workspaces?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  reflectionEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  deepSearch?: boolean;

  @ApiPropertyOptional({ enum: ADVISOR_SCORING_MODES, default: 'llm' })
  @IsOptional()
  @IsEnum(ADVISOR_SCORING_MODES)
  advisorScoringMode?: AdvisorScoringMode;

  @ApiPropertyOptional()
  @IsOptional()
  advisorAutopilotEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  advisorAutopilotTargetScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  advisorAutopilotMaxTurns?: number;
}
