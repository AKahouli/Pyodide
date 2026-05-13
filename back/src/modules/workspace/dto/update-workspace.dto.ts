import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsMongoId,
  ValidateIf,
} from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ description: 'Workspace name', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Workspace description', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Workspace settings ID (null to clear)' })
  @ValidateIf((o) => o.settings !== null)
  @IsMongoId()
  @IsOptional()
  settings?: string | null;
}
