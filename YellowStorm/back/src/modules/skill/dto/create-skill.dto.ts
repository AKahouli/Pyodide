import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SkillFileKind } from '../skill.types';

export class SkillFileDto {
  @ApiProperty({ description: 'Relative path inside the skill package, e.g. references/REFERENCE.md' })
  @IsString()
  @MaxLength(255)
  path!: string;

  @ApiProperty({ enum: SkillFileKind })
  @IsString()
  kind!: SkillFileKind;

  @ApiPropertyOptional({ description: 'MIME type for the file' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @ApiPropertyOptional({ description: 'Inline text content for the file' })
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  content?: string;
}

export class CreateSkillDto {
  @ApiPropertyOptional({ description: 'Stable skill slug; defaults to name for existing clients' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must use lowercase letters, numbers, and single hyphens only',
  })
  slug?: string;

  @ApiProperty({ description: 'Skill display name' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Name must use lowercase letters, numbers, and single hyphens only',
  })
  name!: string;

  @ApiProperty({ description: 'Description used for skill discovery and activation' })
  @IsString()
  @MaxLength(1024)
  description!: string;

  @ApiPropertyOptional({ description: 'Icon name (react-icons style, e.g. FaSearch)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional({ description: 'Brand color in hex', example: '#4285f4' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Color must be a valid hex color' })
  color?: string;

  @ApiPropertyOptional({
    description: 'Icon color for contrast against background',
    enum: ['light', 'dark'],
    default: 'light',
  })
  @IsOptional()
  @IsEnum(['light', 'dark'])
  iconColor?: 'light' | 'dark';

  @ApiPropertyOptional({ description: 'Optional skill category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: 'License string or bundled license reference' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  license?: string;

  @ApiPropertyOptional({ description: 'Environment or runtime requirements' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  compatibility?: string;

  @ApiPropertyOptional({ description: 'Additional metadata map', type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Allowed tools declared by the skill', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[];

  @ApiPropertyOptional({ description: 'Skill instructions body from SKILL.md' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Bundled references/assets', type: [SkillFileDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  files?: SkillFileDto[];

  @ApiPropertyOptional({ description: 'Whether the skill is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
