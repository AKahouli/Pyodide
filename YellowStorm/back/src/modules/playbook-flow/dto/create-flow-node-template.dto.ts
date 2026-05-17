import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FlowNodeTemplatePortDto,
  FlowNodeTemplateRouterConfigDto,
  FlowNodeTemplateIteratorConfigDto,
  FlowNodeTemplateHumanApprovalConfigDto,
} from './flow-node-template-fields.dto';

export type FlowNodeTemplateNodeType = 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';

export class CreateFlowNodeTemplateDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ enum: ['agent', 'action', 'evaluation', 'iterator', 'router', 'human_approval'] })
  @IsString()
  @IsIn(['agent', 'action', 'evaluation', 'iterator', 'router', 'human_approval'])
  nodeType!: FlowNodeTemplateNodeType;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiProperty({ type: [FlowNodeTemplatePortDto], default: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeTemplatePortDto)
  inputPorts!: FlowNodeTemplatePortDto[];

  @ApiProperty({ type: [FlowNodeTemplatePortDto], default: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeTemplatePortDto)
  outputPorts!: FlowNodeTemplatePortDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  promptTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recommendedAgentTypeSlug?: string | null;

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredToolNames?: string[];

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  executionMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedAgentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedAction?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowNodeTemplateIteratorConfigDto)
  iteratorConfig?: FlowNodeTemplateIteratorConfigDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowNodeTemplateRouterConfigDto)
  routerConfig?: FlowNodeTemplateRouterConfigDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowNodeTemplateHumanApprovalConfigDto)
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfigDto | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
