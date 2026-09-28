import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

class UpdateThrottleSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  limit?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400, description: 'Rate limiter window in seconds.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(86400)
  windowSeconds?: number;
}

class UpdateAuthSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  maxSessionsPerUser?: number;
}

class UpdateDocumentUploadSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 4096 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4096)
  maxFileSizeMb?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  maxFilesPerUpload?: number;

  @ApiPropertyOptional({ type: [String], description: 'Allowed MIME types; empty list allows all.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  allowedMimeTypes?: string[];
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: UpdateThrottleSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => UpdateThrottleSettingsDto)
  throttle?: UpdateThrottleSettingsDto;

  @ApiPropertyOptional({ type: UpdateAuthSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => UpdateAuthSettingsDto)
  auth?: UpdateAuthSettingsDto;

  @ApiPropertyOptional({ type: UpdateDocumentUploadSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => UpdateDocumentUploadSettingsDto)
  documentUpload?: UpdateDocumentUploadSettingsDto;
}
