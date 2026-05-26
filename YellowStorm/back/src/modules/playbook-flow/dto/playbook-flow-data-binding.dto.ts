import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { DATA_BINDING_SOURCE_KINDS } from '../constants/reserved-labels';

export class DataBindingDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  targetNode!: string;

  @ApiProperty()
  @IsString()
  targetPort!: string;

  @ApiProperty({ enum: DATA_BINDING_SOURCE_KINDS })
  @IsEnum(DATA_BINDING_SOURCE_KINDS)
  sourceKind!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceNode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePort?: string;

  @ApiPropertyOptional({ enum: ['current', 'previous'], default: 'current' })
  @IsOptional()
  @IsString()
  iteration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggerPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statePath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  constantValue?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expression?: string;
}
