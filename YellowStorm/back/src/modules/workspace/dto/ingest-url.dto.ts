import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsUrl,
  IsOptional,
  MaxLength,
  IsObject,
} from 'class-validator';

/** Only Authorization may be forwarded to the download URL (SSRF / credential leak mitigation). */
function pickIngestAuthHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      key.toLowerCase() === 'authorization' &&
      typeof headerValue === 'string' &&
      headerValue.trim().length > 0
    ) {
      result.Authorization = headerValue;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export class IngestUrlDto {
  @ApiProperty({
    description: 'HTTPS URL to download the file from',
    example: 'https://example.sharepoint.com/download?token=abc',
  })
  @IsUrl({ require_tld: true, protocols: ['https'] })
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
    description:
      'Optional Authorization header for the download. Other header names are stripped. Credentials are not forwarded across cross-origin redirects.',
    example: { Authorization: 'Bearer eyJ...' },
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }) => pickIngestAuthHeaders(value))
  authHeaders?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Source metadata stored with the document (e.g., connector name, original item ID)',
    example: { source: 'sharepoint', driveId: 'abc', itemId: '123' },
  })
  @IsOptional()
  @IsObject()
  sourceMeta?: Record<string, string>;
}
