import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Request body for the internal signed-download endpoint.
 * `filePath` is the Ceph object key (may contain slashes).
 */
export class DownloadUrlRequestDto {
  @ApiProperty({
    description: 'Ceph object key / file path to sign a download URL for',
    maxLength: 1024,
    example: 'workspaces/abc/report.pdf',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  filePath!: string;

  @ApiPropertyOptional({
    description: 'URL validity in minutes (defaults to storage.sasExpiryMinutes). Max 24h.',
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  expiryMinutes?: number;
}
