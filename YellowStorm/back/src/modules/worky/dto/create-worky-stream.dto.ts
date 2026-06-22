import { IsOptional, IsString, IsMongoId, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_STREAM_TITLE_MAX, WORKY_STREAM_TITLE_MIN } from '../constants/worky.constants';

export class CreateWorkyStreamDto {
  @ApiProperty({ description: 'Stream title', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(WORKY_STREAM_TITLE_MIN)
  @MaxLength(WORKY_STREAM_TITLE_MAX)
  title!: string;

  @ApiPropertyOptional({ description: 'Parent workspace the stream belongs to' })
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;
}
