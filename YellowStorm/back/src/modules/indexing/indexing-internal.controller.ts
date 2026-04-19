import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { Public } from '../auth/decorators/public.decorator';
import { IndexingService } from './indexing.service';

@ApiTags('Document Indexing (Internal)')
@Controller('internal/workspaces/:workspaceId/documents')
@UseGuards(InternalServiceGuard)
export class IndexingInternalController {
  constructor(private readonly indexingService: IndexingService) {}

  @Public()
  @Post(':docId/reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger re-indexing of a document (internal)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'docId', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Re-indexing triggered' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @ApiResponse({ status: 400, description: 'Document cannot be indexed' })
  async reindexDocument(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
  ) {
    const document = await this.indexingService.reindexDocument(workspaceId, docId);
    return {
      id: document._id.toString(),
      indexingStatus: document.indexingStatus,
      message: 'Re-indexing triggered',
    };
  }

  @Public()
  @Get(':docId/index-status')
  @ApiOperation({ summary: 'Get indexing status of a document (internal)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'docId', description: 'Document ID' })
  @ApiResponse({ status: 200, description: 'Indexing status retrieved' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getIndexStatus(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
  ) {
    return this.indexingService.getDocumentIndexStatus(workspaceId, docId);
  }
}
