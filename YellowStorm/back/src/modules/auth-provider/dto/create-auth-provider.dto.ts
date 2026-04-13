import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUrl,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAuthProviderDto {
  @ApiProperty({ description: 'Unique provider key (lowercase alphanumeric + hyphens)', example: 'microsoft' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, { message: 'providerKey must contain only lowercase letters, numbers, and hyphens' })
  providerKey!: string;

  @ApiProperty({ description: 'Display name shown in UI', example: 'Microsoft' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

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

  @ApiProperty({ description: 'OAuth authorization endpoint URL' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  authorizationUrl!: string;

  @ApiProperty({ description: 'OAuth token endpoint URL' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  tokenUrl!: string;

  @ApiProperty({ description: 'OAuth userinfo endpoint URL' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  userinfoUrl!: string;

  @ApiPropertyOptional({ description: 'OAuth scopes', default: ['openid', 'email', 'profile'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Icon key for frontend rendering', example: 'microsoft' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  iconKey?: string;

  @ApiPropertyOptional({ description: 'Display order (lower = first)', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Enable PKCE', default: true })
  @IsBoolean()
  @IsOptional()
  pkceEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable this provider', default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
