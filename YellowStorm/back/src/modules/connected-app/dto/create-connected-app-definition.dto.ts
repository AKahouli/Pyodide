import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateConnectedAppDefinitionDto {
  @ApiProperty({ description: 'Unique app key (lowercase alphanumeric + hyphens)', example: 'google-drive' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'appKey must contain only lowercase letters, numbers, and hyphens' })
  appKey!: string;

  @ApiProperty({ description: 'Display name shown in UI', example: 'Google Drive' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

  @ApiPropertyOptional({ description: 'Description shown in UI' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Icon key for frontend rendering', example: 'google-drive' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  iconKey?: string;

  @ApiProperty({ description: 'OAuth authorization endpoint URL' })
  @IsString()
  @IsNotEmpty()
  authorizationUrl!: string;

  @ApiProperty({ description: 'OAuth token endpoint URL' })
  @IsString()
  @IsNotEmpty()
  tokenUrl!: string;

  @ApiPropertyOptional({ description: 'Token revocation endpoint URL' })
  @IsString()
  @IsOptional()
  revokeUrl?: string;

  @ApiProperty({ description: 'OAuth client ID' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'OAuth client secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @ApiPropertyOptional({ description: 'Tenant ID (for Azure AD)' })
  @IsString()
  @IsOptional()
  tenantId?: string;

  @ApiProperty({ description: 'OAuth scopes to request', example: ['Files.Read.All'] })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  scopes!: string[];

  @ApiPropertyOptional({ description: 'Enable PKCE', default: true })
  @IsBoolean()
  @IsOptional()
  pkceEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable this app', default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Display order (lower = first)', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}
