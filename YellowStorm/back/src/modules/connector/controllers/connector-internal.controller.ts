import { Body, Controller, Post, UseGuards, Optional, Header } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { SemanticMcpServiceGuard } from '../../auth/guards/internal-service-principal.guard';
import { ConnectorTransferService } from '../connector-transfer.service';
import { InternalImportConnectorItemDto } from '../dto/connector-transfer.dto';
import { InternalMcpTokenDto } from '../dto/mcp-token.dto';
import { ConnectorService } from '../connector.service';
import { SemanticModelMcpJwtService } from '../services/semantic-model-mcp-jwt.service';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

@ApiTags('Connectors (Internal)')
@Controller('connectors/internal')
export class ConnectorInternalController {
  constructor(private readonly transferService: ConnectorTransferService,
    @Optional() private readonly connectors?: ConnectorService,
    @Optional() private readonly mcpJwt?: SemanticModelMcpJwtService) {}

  @Post('mcp-token')
  @Public()
  @Header('Cache-Control', 'no-store')
  // Scoped to the semantic-model-mcp principal (WP07.2/WP07.3): the shared
  // internal secret and the app-runtime bind token must never mint MCP JWTs.
  @UseGuards(SemanticMcpServiceGuard)
  @ApiHeader({ name: 'X-Yellowstorm-Service-Principal', required: true })
  @ApiHeader({ name: 'X-Yellowstorm-Service-Token', required: true })
  @ApiOperation({ summary: 'Issue or renew an internal MCP JWT for a trusted runtime' })
  async issueMcpToken(@Body() dto: InternalMcpTokenDto) {
    const connector = await this.connectors!.findById(dto.connectorId);
    if (!connector.isActive || connector.mcpTransportType !== 'streamable_http') {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'MCP connector is inactive or uses an unsupported transport');
    }
    return this.mcpJwt!.issue(connector.mcpServerUrl, dto.userId);
  }

  @Post('transfer/import')
  @Public()
  @UseGuards(InternalServiceGuard)
  @ApiOperation({ summary: 'Import connector items on behalf of a user (internal)' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  async importFromConnector(@Body() dto: InternalImportConnectorItemDto): Promise<unknown> {
    return this.transferService.importToWorkspace(
      dto.userId,
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
