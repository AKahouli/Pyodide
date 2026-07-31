import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUrl,
  IsOptional,
  MaxLength,
  IsObject,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/** Only Authorization may be forwarded to the download URL (credential exfil / SSRF). */
export const INGEST_ALLOWED_AUTH_HEADER_NAMES = new Set(['authorization']);

@ValidatorConstraint({ name: 'ingestAuthHeaders', async: false })
export class IngestAuthHeadersConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value as Record<string, unknown>).every((key) =>
      INGEST_ALLOWED_AUTH_HEADER_NAMES.has(key.toLowerCase()),
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'authHeaders may only include Authorization';
  }
}

export class IngestUrlDto {
  @ApiProperty({
    description: 'HTTPS URL to download the file from (SSRF-checked before fetch)',
    example: 'https://example.sharepoint.com/download?token=abc',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
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
      'Authorization header only (e.g. Bearer token). Other header names are rejected. ' +
      'Stripped automatically if a redirect changes origin.',
    example: { Authorization: 'Bearer eyJ...' },
  })
  @IsOptional()
  @IsObject()
  @Validate(IngestAuthHeadersConstraint)
  authHeaders?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Source metadata stored with the document (e.g., connector name, original item ID)',
    example: { source: 'sharepoint', driveId: 'abc', itemId: '123' },
  })
  @IsOptional()
  @IsObject()
  sourceMeta?: Record<string, string>;
}
