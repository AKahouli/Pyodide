import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateWorkspaceUploadSettingsDto {
  @ApiProperty({
    description:
      'List of file extensions authorized for upload. Each entry must be a dot-prefixed ' +
      'lowercase extension that exists in the backend extension-to-MIME map (e.g. ".pdf").',
    example: ['.pdf', '.docx', '.png'],
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  allowedExtensions!: string[];
}
