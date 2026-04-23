import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUrl,
  IsOptional,
  MaxLength,
  IsObject,
} from 'class-validator';

export class IngestUrlDto {
  @ApiProperty({
    description: 'URL to download the file from',
    example: 'https://example.sharepoint.com/download?token=abc',
  })
  @IsUrl({ require_tld: false })
  downloadUrl!: string;

  @ApiProperty({
    description: 'Target filename for the workspace',
    example: 'quarterly-report.xlsx',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'User ID on whose behalf the file is ingested (trusted via service auth)',
  })
  @IsString()
  userId!: string;

  @ApiPropertyOptional({
    description: 'File MIME type. If omitted, inferred from the download response Content-Type header.',
    example: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Authorization headers to include when downloading the file (e.g., Bearer token)',
    example: { Authorization: 'Bearer eyJ...' },
  })
  @IsOptional()
  @IsObject()
  authHeaders?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Source metadata stored with the document (e.g., connector name, original item ID)',
    example: { source: 'sharepoint', driveId: 'abc', itemId: '123' },
  })
  @IsOptional()
  @IsObject()
  sourceMeta?: Record<string, string>;
}
