import { ArrayContains, ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsString, IsBoolean, IsArray, IsOptional, IsIn, MaxLength, Matches, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MODEL_INPUT_MODALITIES, MODEL_TYPES, ModelInputModality } from '../interfaces/model.interface';

export class ReasoningEffortOptionDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(50)
  id!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpdateModelDto {
  @ApiPropertyOptional({ description: 'Model display name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Primary provider display name (e.g., OpenAI)' })
  @IsString()
  @IsOptional()
  chef?: string;

  @ApiPropertyOptional({ description: 'Primary provider slug (e.g., openai)' })
  @IsString()
  @IsOptional()
  chefSlug?: string;

  @ApiPropertyOptional({ description: 'List of provider slugs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  providers?: string[];

  @ApiPropertyOptional({
    description: 'Model classification type',
    enum: MODEL_TYPES,
  })
  @IsIn(MODEL_TYPES)
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: 'Model classification types',
    enum: MODEL_TYPES,
    isArray: true,
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(MODEL_TYPES, { each: true })
  @IsOptional()
  types?: string[];

  @ApiPropertyOptional({ description: 'Whether the model is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether to omit temperature from requests for this model' })
  @IsBoolean()
  @IsOptional()
  omitTemperature?: boolean;

  @ApiPropertyOptional({
    description: 'Input modalities supported by this model. Text is required.',
    enum: MODEL_INPUT_MODALITIES,
    isArray: true,
    default: ['text'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayContains(['text'])
  @IsIn(MODEL_INPUT_MODALITIES, { each: true })
  @IsOptional()
  inputModalities?: ModelInputModality[];

  @ApiPropertyOptional({ type: [ReasoningEffortOptionDto], description: 'Selectable reasoning efforts supported by this model' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((option: ReasoningEffortOptionDto) => option.id)
  @ValidateNested({ each: true })
  @Type(() => ReasoningEffortOptionDto)
  reasoningEfforts?: ReasoningEffortOptionDto[];

  @ApiPropertyOptional({ description: 'Default reasoning effort ID', maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(50)
  defaultReasoningEffort?: string | null;
}
