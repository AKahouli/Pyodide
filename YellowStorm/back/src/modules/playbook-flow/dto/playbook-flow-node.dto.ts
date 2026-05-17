import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, MinLength, MaxLength, IsOptional, IsArray, IsObject, IsEnum,
  ValidateNested, IsNumber, Min, Max, IsBoolean, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NODE_KINDS } from '../constants/node-kinds';
import { CONTROL_EDGE_KINDS, DATA_BINDING_SOURCE_KINDS } from '../constants/reserved-labels';

export class FlowTriggerConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class FlowSettingsDto {
  @ApiProperty({ default: 25 })
  @IsNumber()
  @Min(1)
  @Max(50)
  recursionLimit!: number;

  @ApiProperty({ default: 5 })
  @IsNumber()
  @Min(1)
  @Max(20)
  maxParallelism!: number;
}

export class FlowNodePortDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class FlowNodeInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  raw?: string;

  @ApiPropertyOptional({ type: [FlowNodePortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodePortDto)
  ports?: FlowNodePortDto[];
}

export class FlowNodeOutputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  raw?: string;

  @ApiPropertyOptional({ type: [FlowNodePortDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodePortDto)
  ports?: FlowNodePortDto[];
}

export class RouterConfigDto {
  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  outputLabels!: string[];

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1)
  @Max(50)
  maxIterations!: number;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouterConditionDto)
  conditions?: RouterConditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultLabel?: string;
}

export class RouterConditionDto {
  @ApiProperty()
  @IsString()
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceNode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePort?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  path?: string;

  @ApiProperty({ enum: ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte'] })
  @IsString()
  @IsIn(['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte'])
  operator!: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;
}

export class IteratorConfigDto {
  @ApiProperty()
  @IsString()
  collectionPath!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxItems?: number;
}

export class HumanApprovalConfigDto {
  @ApiProperty()
  @IsString()
  promptTemplate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  timeoutSeconds?: number;
}

export class RetryPolicyDto {
  @ApiProperty({ default: 1 })
  @IsNumber()
  @Min(0)
  @Max(10)
  maxRetries!: number;

  @ApiPropertyOptional({ default: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  delayMs?: number;
}

export class FlowNodeDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ enum: NODE_KINDS })
  @IsEnum(NODE_KINDS)
  kind!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  promptTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputFormatId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowNodeInputDto)
  input?: FlowNodeInputDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowNodeOutputDto)
  output?: FlowNodeOutputDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => RouterConfigDto)
  routerConfig?: RouterConfigDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => IteratorConfigDto)
  iteratorConfig?: IteratorConfigDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => HumanApprovalConfigDto)
  humanApprovalConfig?: HumanApprovalConfigDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => RetryPolicyDto)
  retryPolicy?: RetryPolicyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
