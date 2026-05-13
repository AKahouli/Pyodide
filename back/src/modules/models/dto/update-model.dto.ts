import { IsString, IsBoolean, IsArray, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: 'Whether the model is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
