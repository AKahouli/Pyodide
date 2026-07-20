import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InspectMcpDto {
  @ApiProperty({ description: 'MCP transport type' })
  @IsString()
  transportType!: string;

  @ApiProperty({ description: 'MCP server URL or stdio command' })
  @IsString()
  @MaxLength(1024)
  serverUrl!: string;

  @ApiPropertyOptional({ description: 'MCP server extra configuration', type: Object })
  @IsOptional()
  @IsObject()
  serverConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Connected app key to use for runtime auth injection' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  connectedAppKey?: string;

  @ApiPropertyOptional({ description: 'Runtime auth injection config', type: Object })
  @IsOptional()
  @IsObject()
  runtimeAuthConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Existing connector used to resolve credential-backed authentication' })
  @IsOptional()
  @IsString()
  connectorId?: string;
}
