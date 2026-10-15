import { IsArray, ValidateNested, IsObject, IsOptional, IsString, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ConnectorDynamicHeaderDto } from './create-connector.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REMOTE_INSPECTABLE_MCP_TRANSPORTS, RemoteInspectableMcpTransport } from '../utils/remote-mcp-transport.util';

export class InspectMcpDto {
  @ApiPropertyOptional({ type: [ConnectorDynamicHeaderDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectorDynamicHeaderDto)
  dynamicHeaders?: ConnectorDynamicHeaderDto[];

  @ApiProperty({ description: 'MCP transport type', enum: REMOTE_INSPECTABLE_MCP_TRANSPORTS })
  @IsIn(REMOTE_INSPECTABLE_MCP_TRANSPORTS)
  transportType!: RemoteInspectableMcpTransport;

  @ApiProperty({ description: 'MCP server URL' })
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
