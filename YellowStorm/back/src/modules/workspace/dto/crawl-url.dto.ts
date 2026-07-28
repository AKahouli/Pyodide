import { IsUrl } from 'class-validator';

export class CrawlUrlDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid http(s) URL' })
  url!: string;
}
