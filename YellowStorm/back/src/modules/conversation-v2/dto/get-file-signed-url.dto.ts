import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GetFileSignedUrlDto {
  @ApiProperty({
    description:
      'Ceph object key in the form `{ownerUserId}/{storagePrefix}/{filename}` — the `path` field of a FileInfo attachment.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4048)
  path!: string;
}
