import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, MinLength, MaxLength, IsOptional, IsArray, IsEnum,
  ValidateNested, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FlowNodeDto } from './playbook-flow-node.dto';
import { ControlEdgeDto } from './playbook-flow-control-edge.dto';
import { DataBindingDto } from './playbook-flow-data-binding.dto';
import { FlowTriggerConfigDto, FlowSettingsDto } from './playbook-flow-node.dto';
import { NODE_KINDS } from '../constants/node-kinds';

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
}
