import { IsString, IsArray, IsOptional, IsBoolean, IsNumber, MinLength, MaxLength, ArrayMinSize, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Role name (lowercase, alphanumeric with underscores)',
    example: 'content_manager',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'Role name must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
  name!: string;

  @ApiProperty({
    description: 'Role description',
    example: 'Content manager with workspace and document permissions',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    description: 'Array of permission strings',
    example: ['workspaces.*', 'reports.read'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(0)
  @IsString({ each: true })
  permissions!: string[];

  @ApiPropertyOptional({
    description: 'Whether the role is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Role priority for display ordering (higher = more privileged)',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  priority?: number;
}
