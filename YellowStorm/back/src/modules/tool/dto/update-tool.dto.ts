import { IsString, IsOptional, IsBoolean, IsArray, IsEnum, Matches, MinLength, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ToolAttributeDto } from './tool-attribute.dto';

export class UpdateToolDto {
  @ApiPropertyOptional({ description: 'Tool name', minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Tool description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

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
  })
  @IsOptional()
  @IsEnum(['light', 'dark'])
  iconColor?: 'light' | 'dark';

  @ApiPropertyOptional({ description: 'Optional tool category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: 'Default agent type names', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  defaultAgentTypes?: string[];

  @ApiPropertyOptional({ description: 'Tool attributes', type: [ToolAttributeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolAttributeDto)
  attributes?: ToolAttributeDto[];

  @ApiPropertyOptional({ description: 'Connected app key required for this tool', example: 'microsoft' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredAppKey?: string;

  @ApiPropertyOptional({ description: 'Whether the tool is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
