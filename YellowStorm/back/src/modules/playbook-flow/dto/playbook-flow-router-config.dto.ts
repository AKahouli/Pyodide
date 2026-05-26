import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, IsNumber, Min, Max, IsOptional, IsIn, ValidateNested } from 'class-validator';

export class FlowRouterConditionDto {
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

export class FlowRouterConfigDto {
  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  outputLabels!: string[];

  @ApiProperty({ minimum: 1, maximum: 50 })
  @IsNumber()
  @Min(1)
  @Max(50)
  maxIterations!: number;

  @ApiPropertyOptional({ type: [FlowRouterConditionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowRouterConditionDto)
  conditions?: FlowRouterConditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultLabel?: string;
}
