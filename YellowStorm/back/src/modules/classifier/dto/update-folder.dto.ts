import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFolderDto {
  @ApiPropertyOptional({ description: 'New folder name', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'New folder description', minLength: 1, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description?: string;
}
