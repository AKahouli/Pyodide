import { ArrayMaxSize, ArrayUnique, IsArray, IsString, IsInt, Min, Max, IsOptional } from 'class-validator';
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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10240)
  maxFileSizeMb?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1048576)
  conversationWorkspaceStorageMb?: number;
}

export class UpdateWorkspaceStorageDto {
  @IsInt()
  @Min(1)
  @Max(1048576)
  allocatedStorageMb!: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedAllocatedStorage!: number;
}
