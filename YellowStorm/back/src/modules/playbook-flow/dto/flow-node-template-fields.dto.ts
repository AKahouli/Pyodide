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
} from 'class-validator';

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
