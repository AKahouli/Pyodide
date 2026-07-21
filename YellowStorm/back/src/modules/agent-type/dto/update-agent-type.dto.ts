import { IsString, IsOptional, IsBoolean, MinLength, MaxLength, Matches, IsArray, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAgentTypeDto {
  @ApiPropertyOptional({ description: 'Agent type name', minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 -]+$/, { message: 'Name must contain only letters, numbers, spaces, and hyphens' })
  name?: string;

  @ApiPropertyOptional({ description: 'Default prompt template (fallback when no model-specific prompt exists)', maxLength: 50000 })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  defaultPrompt?: string;

  @ApiPropertyOptional({ description: 'Skill IDs inherited by agents of this type', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: 'Whether the agent type is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
