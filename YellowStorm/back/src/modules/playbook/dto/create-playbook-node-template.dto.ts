import { IsString, IsOptional, IsBoolean, IsArray, IsNumber, Min, MaxLength, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TaskPortDto {
  @IsString()
  @MaxLength(120)
  id!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(80)
  artifactKind!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;
}

export class CreatePlaybookNodeTemplateDto {
  @IsString()
  @MaxLength(120)
  key!: string;

  @IsString()
  @MaxLength(120)
  type!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @IsString()
  @MaxLength(80)
  category!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskPortDto)
  inputPorts!: TaskPortDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskPortDto)
  outputPorts!: TaskPortDto[];

  @IsOptional()
  @IsString()
  promptTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recommendedAgentTypeSlug?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredToolNames?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  executionMode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedAgentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  selectedAction?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
