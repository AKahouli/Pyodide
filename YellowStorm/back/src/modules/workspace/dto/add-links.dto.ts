import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUrl } from 'class-validator';

export class AddLinksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUrl({ require_protocol: true }, { each: true, message: 'each url must be a valid http(s) URL' })
  urls!: string[];

  @IsOptional()
  @IsBoolean()
  deepSearch?: boolean;

  @IsOptional()
  @IsBoolean()
  autoIndex?: boolean;
}
