import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class PlaybookIntentImageInputDto {
  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] })
  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  mediaType!: string;

  @ApiProperty({ description: 'Base64-encoded image bytes without the data URL prefix.' })
  @IsString()
  @MaxLength(2_100_000)
  @Matches(/^[A-Za-z0-9+/=]+$/)
  data!: string;

  @ApiPropertyOptional({ description: 'Original pasted image filename, when available.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class RequestPlaybookFlowIntentDto {
  @ApiProperty({ description: 'Raw user intent entered from the canvas assistant bar.' })
  @IsString()
  @MaxLength(20000)
  intent!: string;

  @ApiPropertyOptional({ description: 'Selected node id when the assistant is focused on an existing node.' })
  @IsOptional()
  @IsString()
  selectedTaskId?: string;

  @ApiPropertyOptional({ type: [PlaybookIntentImageInputDto], description: 'Images pasted into the Designer Assistant prompt.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PlaybookIntentImageInputDto)
  images?: PlaybookIntentImageInputDto[];
}
