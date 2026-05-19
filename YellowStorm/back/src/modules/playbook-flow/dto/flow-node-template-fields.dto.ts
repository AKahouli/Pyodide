import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FlowNodeTemplatePortDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  artifactKind!: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class FlowNodeTemplateRouterConditionDto {
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
  operator!: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;
}

export class FlowNodeTemplateRouterConfigDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  outputLabels!: string[];

  @ApiProperty({ minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  maxIterations!: number;

  @ApiPropertyOptional({ type: [FlowNodeTemplateRouterConditionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowNodeTemplateRouterConditionDto)
  conditions?: FlowNodeTemplateRouterConditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultLabel?: string;
}

export class FlowNodeTemplateIteratorConfigDto {
  @ApiProperty({ maxLength: 400 })
  @IsString()
  source!: string;

  @ApiProperty({ enum: ['item', 'batch'] })
  @IsString()
  @IsIn(['item', 'batch'])
  mode!: 'item' | 'batch';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  batchSize?: number | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  itemVariable?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  outputVariable?: string | null;

  @ApiPropertyOptional({ enum: ['stop', 'continue'] })
  @IsOptional()
  @IsIn(['stop', 'continue'])
  errorStrategy?: 'stop' | 'continue';
}

export class FlowNodeTemplateHumanApprovalConfigDto {
  @ApiProperty()
  @IsString()
  promptTemplate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  timeoutSeconds?: number | null;
}

export class FlowNodeTemplateRetryPolicyDto {
  @ApiProperty({ minimum: 0, maximum: 10, default: 1 })
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries!: number;

  @ApiPropertyOptional({ minimum: 0, default: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  delayMs?: number;
}
