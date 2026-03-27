import { IsString, IsOptional, IsBoolean, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgentTypeDto {
  @ApiProperty({ description: 'Agent type name', example: 'manager', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 ]+$/, { message: 'Name must contain only letters, numbers, and spaces' })
  name!: string;

  @ApiPropertyOptional({ description: 'Default prompt template (fallback when no model-specific prompt exists)', maxLength: 50000 })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  defaultPrompt?: string;

  @ApiPropertyOptional({ description: 'Whether the agent type is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
