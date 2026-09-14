import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ConnectorActionResultKind, ConnectorActionSafety, ConnectorAuthSourceType, ConnectorAuthType, ConnectorCitationMode, DynamicHeaderSource, McpTransportType } from '../schemas/connector.schema';

export class ConnectorDynamicHeaderDto {
  @ApiProperty({ description: 'HTTP header name to inject, e.g. X-User-Id' })
  @IsString()
  @MaxLength(128)
  headerName!: string;

  @ApiProperty({ enum: DynamicHeaderSource, description: 'Source value resolved per user at runtime' })
  @IsEnum(DynamicHeaderSource)
  source!: DynamicHeaderSource;

  @ApiPropertyOptional({ description: 'Whether the dynamic header is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ConnectorActionDto {
  @ApiProperty({ description: 'Action key, e.g. list_files' })
  @IsString()
  @MaxLength(128)
  key!: string;

  @ApiProperty({ description: 'Human-readable action label' })
  @IsString()
  @MaxLength(128)
  label!: string;

  @ApiPropertyOptional({ description: 'Action description' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  @ApiPropertyOptional({ description: 'JSON Schema for action parameters', type: Object })
  @IsOptional()
  @IsObject()
  parameterSchema?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'JSON Schema for action output', type: Object })
  @IsOptional()
  @IsObject()
  outputSchema?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ConnectorActionSafety, description: 'Safety classification' })
  @IsOptional()
  @IsString()
  safety?: ConnectorActionSafety;

  @ApiPropertyOptional({ description: 'Whether the action supports batch mode' })
  @IsOptional()
  @IsBoolean()
  supportsBatch?: boolean;

  @ApiPropertyOptional({ description: 'Whether the action supports iteration over collections' })
  @IsOptional()
  @IsBoolean()
  supportsIteration?: boolean;

  @ApiPropertyOptional({ description: 'Whether the action is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ enum: ConnectorActionResultKind, default: ConnectorActionResultKind.GENERIC })
  @IsOptional()
  @IsEnum(ConnectorActionResultKind)
  resultKind?: ConnectorActionResultKind;

  @ApiPropertyOptional({ enum: ConnectorCitationMode, default: ConnectorCitationMode.NONE })
  @IsOptional()
  @IsEnum(ConnectorCitationMode)
  citationMode?: ConnectorCitationMode;

  @ApiPropertyOptional({ description: 'Provider response field mapping', type: Object })
  @IsOptional()
  @IsObject()
  resultMapping?: Record<string, unknown>;
}

export class CreateConnectorDto {
  @ApiProperty({ description: 'Unique connector slug' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must use lowercase letters, numbers, and single hyphens only',
  })
  slug!: string;

  @ApiProperty({ description: 'Connector display name' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty({ description: 'Connector description' })
  @IsString()
  @MaxLength(1024)
  description!: string;

  @ApiPropertyOptional({ description: 'Icon name (lucide icon)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional({ description: 'Brand color hex', example: '#4285f4' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Color must be a valid hex color' })
  color?: string;

  @ApiPropertyOptional({
    description: 'Icon color for contrast against background',
    enum: ['light', 'dark'],
    default: 'light',
  })
  @IsOptional()
  @IsEnum(['light', 'dark'])
  iconColor?: 'light' | 'dark';

  @ApiPropertyOptional({ description: 'Optional connector category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: ConnectorAuthType, description: 'Authentication type' })
  @IsOptional()
  @IsString()
  authType?: ConnectorAuthType;

  @ApiPropertyOptional({ description: 'JSON Schema for auth configuration', type: Object })
  @IsOptional()
  @IsObject()
  authConfigSchema?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ConnectorAuthSourceType, description: 'Where user auth comes from' })
  @IsOptional()
  @IsString()
  authSourceType?: ConnectorAuthSourceType;

  @ApiPropertyOptional({ description: 'Connected app key for OAuth-backed connectors (e.g. microsoft, github)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  connectedAppKey?: string;

  @ApiPropertyOptional({ description: 'Runtime auth injection config (strategy, headers, env mapping)', type: Object })
  @IsOptional()
  @IsObject()
  runtimeAuthConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'MCP transport type' })
  @IsOptional()
  @IsString()
  mcpTransportType?: McpTransportType;

  @ApiPropertyOptional({ description: 'MCP server URL (for http/sse/streamable_http) or command (for stdio)' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  mcpServerUrl?: string;

  @ApiPropertyOptional({ description: 'MCP server extra configuration (e.g. commandArgs, env for stdio)', type: Object })
  @IsOptional()
  @IsObject()
  mcpServerConfig?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Dynamic per-user headers (e.g. X-User-Id mapped to the calling user)',
    type: [ConnectorDynamicHeaderDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectorDynamicHeaderDto)
  dynamicHeaders?: ConnectorDynamicHeaderDto[];

  @ApiPropertyOptional({ description: 'Connector actions', type: [ConnectorActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectorActionDto)
  actions?: ConnectorActionDto[];

  @ApiPropertyOptional({ description: 'Referenced skill IDs from the skill registry', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referencedSkillIds?: string[];

  @ApiPropertyOptional({ description: 'Whether the connector is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether the connector is hidden from the catalog', default: false })
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;
}
