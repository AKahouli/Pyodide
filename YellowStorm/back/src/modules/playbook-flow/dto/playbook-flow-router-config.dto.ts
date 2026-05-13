import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsNumber, Min, Max } from 'class-validator';

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
}
