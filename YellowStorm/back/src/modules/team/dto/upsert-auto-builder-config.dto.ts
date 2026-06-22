import { IsString, IsNotEmpty, IsNumber, IsBoolean, MinLength, MaxLength, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertAutoBuilderConfigDto {
  @ApiProperty({ description: 'Model ID to use for generation' })
  @IsString()
  @IsNotEmpty()
  modelId!: string;

  @ApiProperty({ description: 'System prompt that controls AI output format', minLength: 10, maxLength: 10000 })
  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  systemPrompt!: string;

  @ApiProperty({ description: 'Temperature (0-2)', default: 0.7 })
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature!: number;

  @ApiProperty({ description: 'Whether the auto-builder is enabled', default: false })
  @IsBoolean()
  isEnabled!: boolean;
}
