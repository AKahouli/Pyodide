import { IsString, IsEnum, IsOptional, IsArray, IsNotEmpty, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToolAttributeType } from '../schemas/tool.schema';

export class ToolAttributeDto {
  @ApiProperty({ description: 'Attribute name', example: 'apiKey' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Attribute type', enum: ToolAttributeType, example: ToolAttributeType.STRING })
  @IsEnum(ToolAttributeType)
  type!: ToolAttributeType;

  @ApiProperty({ description: 'Attribute value', example: 'my-api-key' })
  @IsNotEmpty()
  value!: string | number | boolean;

  @ApiPropertyOptional({ description: 'Options for enum type', type: [String], example: ['option1', 'option2'] })
  @ValidateIf((o) => o.type === ToolAttributeType.ENUM)
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}
