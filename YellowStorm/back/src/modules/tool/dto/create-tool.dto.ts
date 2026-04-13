import { IsString, IsOptional, IsBoolean, IsArray, MinLength, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToolAttributeDto } from './tool-attribute.dto';

export class CreateToolDto {
  @ApiProperty({ description: 'Tool name', example: 'Web Search', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Tool description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

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

  @ApiPropertyOptional({ description: 'Whether the tool is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
