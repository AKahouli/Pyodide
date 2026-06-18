import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryWorkyStreamsDto {
  @ApiPropertyOptional({ description: 'Free-text search by stream title' })
  @IsOptional()
  @IsString()
  search?: string;
}
