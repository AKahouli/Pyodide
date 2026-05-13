import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, MinLength, IsMongoId } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ description: 'Workspace name', example: 'My Project', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Workspace description', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Workspace settings ID' })
  @IsMongoId()
  @IsOptional()
  settings?: string;
}
