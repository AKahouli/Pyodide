import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUrl } from 'class-validator';

export class CheckUrlsDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUrl({ require_protocol: true }, { each: true })
  urls!: string[];
}
