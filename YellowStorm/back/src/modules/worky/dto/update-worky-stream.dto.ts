import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_STREAM_TITLE_MAX, WORKY_STREAM_TITLE_MIN } from '../constants/worky.constants';

export class UpdateWorkyStreamDto {
  @ApiPropertyOptional({ description: 'Stream title', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(WORKY_STREAM_TITLE_MIN)
  @MaxLength(WORKY_STREAM_TITLE_MAX)
  title?: string;
}
