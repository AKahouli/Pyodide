import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TEMPLATE_SLUG_REGEX } from '../constants/template-catalog.constants';

export class CreateTemplateCategoryDto {
  @ApiProperty({ description: 'Category display name', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({
    description: 'Stable public slug (kebab-case). Generated from the name when omitted.',
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(TEMPLATE_SLUG_REGEX, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @ApiPropertyOptional({ description: 'Display icon (emoji or icon name)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  icon?: string;
}
