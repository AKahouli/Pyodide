import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateResponseReliabilitySettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: ['informative'] })
  @IsIn(['informative'])
  mode!: 'informative';

  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  judgeModelId!: string | null;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxConcurrentEvaluations!: number;

  @ApiProperty({ minimum: 5000, maximum: 120000 })
  @IsInt()
  @Min(5000)
  @Max(120000)
  timeoutMs!: number;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxFindings!: number;
}

export class UpdateEvaluationSettingsDto {
  @ApiProperty({ type: UpdateResponseReliabilitySettingsDto })
  @ValidateNested()
  @Type(() => UpdateResponseReliabilitySettingsDto)
  responseReliability!: UpdateResponseReliabilitySettingsDto;
}
