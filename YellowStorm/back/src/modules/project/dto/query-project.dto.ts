import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryProjectDto {
  @ApiPropertyOptional({ description: 'Search by project name' })
  @IsOptional()
  @IsString()
  search?: string;
}
