import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConnectorCategoryDto {
  @ApiProperty({ description: 'Category display name' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ description: 'Optional category description' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;
}
