import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { CONTROL_EDGE_KINDS } from '../constants/reserved-labels';

export class ControlEdgeDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ enum: CONTROL_EDGE_KINDS })
  @IsEnum(CONTROL_EDGE_KINDS)
  kind!: string;

  @ApiProperty()
  @IsString()
  source!: string;

  @ApiProperty()
  @IsString()
  target!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  routerLabel?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;
}
