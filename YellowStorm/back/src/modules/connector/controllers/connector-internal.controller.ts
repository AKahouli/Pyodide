import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { ConnectorTransferService } from '../connector-transfer.service';
import { InternalImportConnectorItemDto } from '../dto/connector-transfer.dto';

@ApiTags('Connectors (Internal)')
@Controller('connectors/internal')
@Public()
@UseGuards(InternalServiceGuard)
export class ConnectorInternalController {
  constructor(private readonly transferService: ConnectorTransferService) {}

  @Post('transfer/import')
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
