import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpsertFlowPromptTemplateDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  category!: string;

  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
