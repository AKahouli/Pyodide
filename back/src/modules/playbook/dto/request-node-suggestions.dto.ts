import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestNodeSuggestionsDto {
  @ApiPropertyOptional({ description: 'Unsaved title draft for the selected task.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Unsaved description draft for the selected task.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiPropertyOptional({ description: 'Unsaved expected result draft for the selected task.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  expectedResult?: string | null;
}
