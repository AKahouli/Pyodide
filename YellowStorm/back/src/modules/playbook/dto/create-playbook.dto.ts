import { IsString, MinLength, MaxLength, IsOptional, IsArray, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlaybookDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Workspace IDs to attach' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];
}
