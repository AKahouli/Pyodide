import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class ExportSlideImageDto {
  @ApiProperty({ description: 'An HTTPS image URL referenced by this saved answer' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(8192)
  url!: string;
}
