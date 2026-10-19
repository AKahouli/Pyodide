import { IsOptional, Matches } from 'class-validator';

export class ImageHistoryDto {
  @IsOptional()
  @Matches(/^generated-image:[a-f0-9]{24}$/)
  versionSource?: string;
}
