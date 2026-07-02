import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class ImportFlowPromptTemplateItemDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsOptional()
  @IsString()
  systemTemplate?: string;

  @IsOptional()
  @IsString()
  userTemplate?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isBuiltIn?: boolean;
}

export class ImportFlowPromptTemplatesDto {
  @ApiProperty({ enum: [1] })
  @IsIn([1])
  version!: 1;

  @ApiProperty({ enum: ['playbook-prompts'] })
  @IsIn(['playbook-prompts'])
  type!: 'playbook-prompts';

  @ApiProperty({ type: [ImportFlowPromptTemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportFlowPromptTemplateItemDto)
  items!: ImportFlowPromptTemplateItemDto[];
}
