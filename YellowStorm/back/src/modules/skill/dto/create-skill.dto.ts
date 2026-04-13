import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SkillFileKind } from '../schemas/skill.schema';

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
  @MaxLength(200000)
  content?: string;
}

export class CreateSkillDto {
  @ApiProperty({ description: 'Skill slug matching the AgentSkills spec' })
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
