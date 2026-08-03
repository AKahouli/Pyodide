import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class GetAppSourceUrlsDto {
  @ApiProperty({
    description: 'Ceph prefix for the generated project (ApplicationComponentEvent.ceph_path).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  cephPath!: string;

  @ApiProperty({
    description: 'Relative file paths under cephPath (e.g. app/page.tsx).',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1024, { each: true })
  paths!: string[];
}
