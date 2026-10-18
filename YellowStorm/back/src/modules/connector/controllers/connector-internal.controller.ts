import { Body, Controller, Post, UseGuards, Optional, Header, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { AdkNativeActorGuard, type AdkNativeRequest } from '../../auth/guards/adk-native-actor.guard';
import { AdkRuntimeMcpRenewalGuard } from '../../auth/guards/internal-service-principal.guard';
import { ConnectorTransferService } from '../connector-transfer.service';
import { InternalImportConnectorItemDto } from '../dto/connector-transfer.dto';
import { InternalMcpTokenDto } from '../dto/mcp-token.dto';
import { ConnectorService } from '../connector.service';
import { McpJwtService } from '../services/mcp-jwt.service';

@ApiTags('Connectors (Internal)')
@Controller('connectors/internal')
export class ConnectorInternalController {
  constructor(private readonly transferService: ConnectorTransferService,
    @Optional() private readonly connectors?: ConnectorService,
    @Optional() private readonly mcpJwt?: McpJwtService) {}

  @Post('mcp-token')
  @Public()
  @Header('Cache-Control', 'no-store')
  // Renewal authority belongs to the runtime, not receiving MCP services.
  @UseGuards(AdkRuntimeMcpRenewalGuard)
  @ApiHeader({ name: 'X-Yellowstorm-Service-Principal', required: true })
  @ApiHeader({ name: 'X-Yellowstorm-Service-Token', required: true })
  @ApiOperation({ summary: 'Renew an MCP JWT from a current connector-bound assertion' })
  async issueMcpToken(@Body() dto: InternalMcpTokenDto) {
    return this.mcpJwt!.renew(dto.connectorId, dto.assertion);
  }

  @Post('transfer/import')
  @Public()
  @UseGuards(AdkNativeActorGuard)
  @ApiOperation({ summary: 'Import connector items on behalf of a user (internal)' })
  @ApiHeader({ name: 'X-YellowStorm-Execution-Authority', required: true })
  async importFromConnector(@Body() dto: InternalImportConnectorItemDto, @Req() request: AdkNativeRequest): Promise<unknown> {
    return this.transferService.importToWorkspace(
      request.nativeActor.sub,
      dto.connectorId,
      dto.workspaceId,
      {
        mode: dto.mode || 'file',
        itemRef: dto.itemRef,
        itemRefs: dto.itemRefs,
        recursive: dto.recursive ?? true,
        flatten: dto.flatten ?? true,
        filename: dto.filename,
        mimeType: dto.mimeType,
      },
    );
  }
}
