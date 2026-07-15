import { IsUrl } from 'class-validator';

export class AddLinkDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid http(s) URL' })
  url!: string;
}
