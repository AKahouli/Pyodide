import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  IsEnum,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Default COMMON_APP_KEYS (used as fallback if not in .env)
export const DEFAULT_COMMON_APP_KEYS = {
  github: 'github',
  google: 'google',
  microsoft: 'microsoft',
  slack: 'slack',
  notion: 'notion',
  linear: 'linear',
  anthropic: 'anthropic',
  openai: 'openai',
  jira: 'jira',
  asana: 'asana',
  trello: 'trello',
  dropbox: 'dropbox',
  box: 'box',
} as const;

// Legacy export for backward compatibility
export const COMMON_APP_KEYS = DEFAULT_COMMON_APP_KEYS;

export type CommonAppKey = keyof typeof COMMON_APP_KEYS;

export enum ConnectedAppAuthType {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
}

export class CreateConnectedAppDefinitionDto {
  @ApiProperty({ description: 'Unique app key (lowercase alphanumeric + hyphens)', example: 'google-drive' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+(?:-[a-z0-9]+)*$/, { message: 'appKey must contain only lowercase letters, numbers, and hyphens' })
  appKey!: string;

  @ApiPropertyOptional({ description: 'Authentication type: oauth2 or api_key', enum: ConnectedAppAuthType, default: ConnectedAppAuthType.OAUTH2 })
  @IsEnum(ConnectedAppAuthType)
  @IsOptional()
  authType?: ConnectedAppAuthType;

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

  @ApiPropertyOptional({ description: 'OAuth authorization endpoint URL (required for oauth2 type)' })
  @ValidateIf((o) => o.authType === undefined || o.authType === ConnectedAppAuthType.OAUTH2)
  @IsString()
  @IsNotEmpty()
  authorizationUrl?: string;

  @ApiPropertyOptional({ description: 'OAuth token endpoint URL (required for oauth2 type)' })
  @ValidateIf((o) => o.authType === undefined || o.authType === ConnectedAppAuthType.OAUTH2)
  @IsString()
  @IsNotEmpty()
  tokenUrl?: string;

  @ApiPropertyOptional({ description: 'Token revocation endpoint URL' })
  @IsString()
  @IsOptional()
  revokeUrl?: string;

  @ApiPropertyOptional({ description: 'OAuth client ID (required for oauth2 type)' })
  @ValidateIf((o) => o.authType === undefined || o.authType === ConnectedAppAuthType.OAUTH2)
  @IsString()
  @IsNotEmpty()
  clientId?: string;

  @ApiPropertyOptional({ description: 'OAuth client secret (required for oauth2 type)' })
  @ValidateIf((o) => o.authType === undefined || o.authType === ConnectedAppAuthType.OAUTH2)
  @IsString()
  @IsNotEmpty()
  clientSecret?: string;

  @ApiPropertyOptional({ description: 'Tenant ID (for Azure AD)' })
  @IsString()
  @IsOptional()
  tenantId?: string;

  @ApiPropertyOptional({ description: 'OAuth scopes to request (required for oauth2 type)', example: ['Files.Read.All'] })
  @ValidateIf((o) => o.authType === undefined || o.authType === ConnectedAppAuthType.OAUTH2)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Enable PKCE', default: true })
  @IsBoolean()
  @IsOptional()
  pkceEnabled?: boolean;

  @ApiPropertyOptional({ description: 'API Key (required for api_key type)' })
  @ValidateIf((o) => o.authType === ConnectedAppAuthType.API_KEY)
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Enable this app', default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Display order (lower = first)', default: 0 })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Callback URL preview (automatically generated)',
    example: 'http://localhost:3000/api/v1/connected-apps/google-drive/callback'
  })
  @IsString()
  @IsOptional()
  callbackUrlPreview?: string;
}