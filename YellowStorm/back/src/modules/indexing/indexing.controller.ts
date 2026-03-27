import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { IndexingService } from './indexing.service';
import { WorkspaceOwnerGuard } from '../workspace/guards/workspace-owner.guard';

@ApiTags('Document Indexing')
@Controller('workspaces/:workspaceId/documents')
@ApiBearerAuth()
@UseGuards(WorkspaceOwnerGuard)
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  /**
   * Trigger re-indexing of a document
   */
  @Post(':docId/reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger re-indexing of a document' })
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

  /**
   * Get indexing status of a document
   */
  @Get(':docId/index-status')
  @ApiOperation({ summary: 'Get indexing status of a document' })
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
