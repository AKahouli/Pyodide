import { IsString, MinLength, MaxLength, IsOptional, IsArray, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePlaybookDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ minLength: 10, maxLength: 5000, description: 'Prompt describing the desired playbook workflow' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  prompt!: string;

  @ApiPropertyOptional({ type: [String], description: 'Workspace IDs to attach' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];
}
