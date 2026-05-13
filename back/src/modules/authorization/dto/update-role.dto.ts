import { IsString, IsArray, IsOptional, IsBoolean, IsNumber, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'Role name (lowercase, alphanumeric with underscores)',
    example: 'content_manager',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'Role name must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Role description',
    example: 'Content manager with workspace and document permissions',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Array of permission strings',
    example: ['workspaces.*', 'reports.read'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({
    description: 'Whether the role is active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Role priority for display ordering (higher = more privileged)',
  })
  @IsOptional()
  @IsNumber()
  priority?: number;
}
